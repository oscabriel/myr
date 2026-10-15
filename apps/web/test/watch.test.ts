import { describe, expect, it } from "@effect/vitest";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  CommitSha,
  Handle,
  KindName,
  LandedSha,
  ProjectName,
} from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { Clock, DateTime, Effect, Layer, Queue, Ref, Stream } from "effect";
import { AsyncResult, Atom, AtomRegistry, Reactivity } from "effect/reactivity";
import { TestClock } from "effect/testing";

import { projectEventsAtom } from "../src/client/events.ts";
import { keys } from "../src/client/keys.ts";
import {
  POLL_MS,
  ProjectWatch,
  watchAtom,
  watchRuntime,
} from "../src/client/watch.ts";

const datekit = ProjectName.make("oscabriel/datekit");

const parseIso = AskId.make("parse-iso");

const at = DateTime.toUtc(DateTime.makeUnsafe("2026-10-07T12:00:00Z"));

const head = CommitSha.make("a".repeat(40));

const sha = LandedSha.make("b".repeat(40));

const landing: LandingView = {
  ask: parseIso,
  assisted: [],
  author: Handle.make("alice"),
  credits: [{ handle: Handle.make("alice"), role: "Signed-off-by" }],
  landedAt: at,
  parent: LandedSha.make("c".repeat(40)),
  project: datekit,
  sha,
};

const projectKey = "project";

const askKey = "ask";

const invalidations = Effect.gen(function* () {
  const reactivity = yield* Reactivity.make;
  const fired: string[] = [];

  const listen = (key: string, kind: string) =>
    reactivity.registerUnsafe([key], () => {
      fired.push(kind);
    });

  const [askOwn] = keys.ask(datekit, parseIso);

  listen(keys.project(datekit).join(","), projectKey);
  listen(askOwn ?? "", askKey);

  return { fired, reactivity };
});

const tab = (
  follow: (since: number) => Stream.Stream<ProjectEvent, string>,
  reactivity: Reactivity.Reactivity,
  replay: Atom.Type<ReturnType<typeof projectEventsAtom>> = AsyncResult.success(
    []
  )
) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;

    const registry = yield* Effect.acquireRelease(
      Effect.sync(() =>
        AtomRegistry.make({
          initialValues: [
            Atom.initialValue(projectEventsAtom(datekit), replay),
            Atom.initialValue(
              watchRuntime.layer,
              Layer.mergeAll(
                Layer.succeed(ProjectWatch, {
                  follow: (_project, since) => follow(since),
                }),
                Layer.succeed(Reactivity.Reactivity, reactivity),
                Layer.succeed(Clock.Clock, clock)
              )
            ),
          ],
        })
      ),
      (made) =>
        Effect.sync(() => {
          made.dispose();
        })
    );

    registry.mount(watchAtom(datekit));
  });

const runUntil = (done: () => boolean) =>
  Effect.yieldNow.pipe(Effect.repeat({ times: 200, until: done }));

const firedNow = (fired: string[]) =>
  Effect.gen(function* () {
    yield* runUntil(() => fired.length > 0);

    return fired.splice(0).toSorted();
  });

describe(watchAtom, () => {
  it.effect(
    "invalidates the project's keys on AskOpened, AskClosed, Claimed and Landed, and the ask's on Pushed and Judged",
    () =>
      Effect.gen(function* () {
        const { fired, reactivity } = yield* invalidations;
        const events = yield* Queue.unbounded<ProjectEvent>();

        yield* tab(() => Stream.fromQueue(events), reactivity);

        const each = [
          ProjectEvent.cases.AskOpened.make({
            ask: {
              ask: parseIso,
              blockedBy: [],
              claimed: false,
              kind: KindName.make("fix"),
              territory: "src/parse.ts",
              want: "parse reads the year",
            },
            at,
            seq: 1,
          }),
          ProjectEvent.cases.Claimed.make({
            ask: parseIso,
            at,
            claimant: Handle.make("alice"),
            seq: 2,
          }),
          ProjectEvent.cases.Pushed.make({ ask: parseIso, at, head, seq: 3 }),
          ProjectEvent.cases.Judged.make({
            ask: parseIso,
            at,
            head,
            outcome: Outcome.cases.Checking.make({ stage: "merge" }),
            seq: 4,
          }),
          ProjectEvent.cases.Landed.make({ at, landing, seq: 5 }),
          ProjectEvent.cases.AskClosed.make({
            ask: parseIso,
            at,
            landing: sha,
            seq: 6,
          }),
        ];

        const heard: Record<string, readonly string[]> = {};

        for (const event of each) {
          yield* Queue.offer(events, event);
          heard[event._tag] = yield* firedNow(fired);
        }

        expect(heard).toStrictEqual({
          AskClosed: [projectKey],
          AskOpened: [projectKey],
          Claimed: [projectKey],
          Judged: [askKey, projectKey],
          Landed: [projectKey],
          Pushed: [askKey, projectKey],
        });
      })
  );

  it.effect(
    "invalidates the code and policy reads on Landed, and the discussions on AskOpened, since a thread may have become the ask",
    () =>
      Effect.gen(function* () {
        const reactivity = yield* Reactivity.make;
        const fired: string[] = [];

        const listen = (key: string | undefined, kind: string) =>
          reactivity.registerUnsafe([key ?? ""], () => {
            fired.push(kind);
          });

        listen(keys.code(datekit)[0], "code");
        listen(keys.policy(datekit)[0], "policy");
        listen(keys.discussions(datekit)[0], "discussions");
        listen(keys.project(datekit)[0], projectKey);

        const events = yield* Queue.unbounded<ProjectEvent>();

        yield* tab(() => Stream.fromQueue(events), reactivity);

        yield* Queue.offer(
          events,
          ProjectEvent.cases.Landed.make({ at, landing, seq: 1 })
        );

        const landed = yield* firedNow(fired);

        yield* Queue.offer(
          events,
          ProjectEvent.cases.AskOpened.make({
            ask: {
              ask: parseIso,
              blockedBy: [],
              claimed: false,
              kind: KindName.make("fix"),
              territory: "src/parse.ts",
              want: "parse reads the year",
            },
            at,
            seq: 2,
          })
        );

        expect({ asked: yield* firedNow(fired), landed }).toStrictEqual({
          asked: ["discussions", projectKey],
          landed: ["code", "policy", projectKey],
        });
      })
  );

  // The rail lists every project with its open asks and last landing
  // (`projectsAtom`, read under `keys.front()`): an event that changes
  // them reads the list again, as one that leaves them alone does not.
  it.effect(
    "invalidates the project list on AskOpened, AskClosed and Landed, and not on Claimed",
    () =>
      Effect.gen(function* () {
        const reactivity = yield* Reactivity.make;
        const fired: string[] = [];

        reactivity.registerUnsafe([keys.front()[0] ?? ""], () => {
          fired.push("front");
        });

        const events = yield* Queue.unbounded<ProjectEvent>();

        yield* tab(() => Stream.fromQueue(events), reactivity);

        const each = [
          ProjectEvent.cases.AskOpened.make({
            ask: {
              ask: parseIso,
              blockedBy: [],
              claimed: false,
              kind: KindName.make("fix"),
              territory: "src/parse.ts",
              want: "parse reads the year",
            },
            at,
            seq: 1,
          }),
          ProjectEvent.cases.Claimed.make({
            ask: parseIso,
            at,
            claimant: Handle.make("alice"),
            seq: 2,
          }),
          ProjectEvent.cases.Landed.make({ at, landing, seq: 3 }),
          ProjectEvent.cases.AskClosed.make({
            ask: parseIso,
            at,
            landing: sha,
            seq: 4,
          }),
        ];

        const heard: Record<string, readonly string[]> = {};

        for (const event of each) {
          yield* Queue.offer(events, event);
          heard[event._tag] = yield* firedNow(fired);
        }

        expect(heard).toStrictEqual({
          AskClosed: ["front"],
          AskOpened: ["front"],
          Claimed: [],
          Landed: ["front"],
        });
      })
  );

  it.effect(
    "polls every POLL_MS when the stream fails at connect, invalidating the project's keys",
    () =>
      Effect.gen(function* () {
        const { fired, reactivity } = yield* invalidations;

        yield* tab(() => Stream.fail("no framed /rpc here"), reactivity);
        yield* runUntil(() => false);

        const before = [...fired];

        yield* TestClock.adjust(POLL_MS - 1);
        yield* runUntil(() => false);

        const early = [...fired];

        yield* TestClock.adjust(1);

        const first = yield* firedNow(fired);

        yield* TestClock.adjust(POLL_MS);

        expect({
          before,
          early,
          first,
          second: yield* firedNow(fired),
        }).toStrictEqual({
          before: [],
          early: [],
          first: [projectKey],
          second: [projectKey],
        });
      })
  );

  it.effect(
    "follows again from the last number it heard, POLL_MS after a stream that heard something ends",
    () =>
      Effect.gen(function* () {
        const { fired, reactivity } = yield* invalidations;
        const asked = yield* Ref.make<readonly number[]>([]);

        yield* tab(
          (since) =>
            Stream.unwrap(
              Effect.as(
                Ref.update(asked, (all) => [...all, since]),
                since === 0
                  ? Stream.make(
                      ProjectEvent.cases.Claimed.make({
                        ask: parseIso,
                        at,
                        claimant: Handle.make("alice"),
                        seq: 7,
                      })
                    )
                  : Stream.never
              )
            ),
          reactivity
        );

        yield* firedNow(fired);
        yield* TestClock.adjust(POLL_MS);
        yield* runUntil(() => Ref.getUnsafe(asked).length > 1);

        expect(yield* Ref.get(asked)).toStrictEqual([0, 7]);
      })
  );

  it.effect(
    "follows from the last number of the replay the page read, not from the first event",
    () =>
      Effect.gen(function* () {
        const { reactivity } = yield* invalidations;
        const asked = yield* Ref.make<readonly number[]>([]);

        yield* tab(
          (since) =>
            Stream.unwrap(
              Effect.as(
                Ref.update(asked, (all) => [...all, since]),
                Stream.never
              )
            ),
          reactivity,
          AsyncResult.success(
            Array.from({ length: 7 }, (_, index) =>
              ProjectEvent.cases.Warned.make({
                ask: parseIso,
                at,
                seq: index + 1,
              })
            )
          )
        );

        yield* runUntil(() => Ref.getUnsafe(asked).length > 0);

        expect(yield* Ref.get(asked)).toStrictEqual([7]);
      })
  );

  it.effect(
    "hears once an event that came between the replay and the follow",
    () =>
      Effect.gen(function* () {
        const { fired, reactivity } = yield* invalidations;

        const kept = Array.from({ length: 8 }, (_, index) =>
          ProjectEvent.cases.Claimed.make({
            ask: parseIso,
            at,
            claimant: Handle.make("alice"),
            seq: index + 1,
          })
        );

        yield* tab(
          (since) =>
            Stream.concat(
              Stream.fromIterable(kept.filter(({ seq }) => seq > since)),
              Stream.never
            ),
          reactivity,
          AsyncResult.success(kept.slice(0, 7))
        );

        // Once for the page's read after the replay, once for the event.
        yield* runUntil(() => fired.length > 1);
        yield* runUntil(() => fired.length > 2);

        expect(fired).toStrictEqual([projectKey, projectKey]);
      })
  );

  // A page's own reads may be older than the replay (a loader read them on
  // the server; the replay is read in the browser later): what happened in
  // between is in the replay but not on the page, and the stream starts
  // after it.
  it.effect(
    "reads the page once more after the replay, for what came between the page's read and the replay, and never the replay itself",
    () =>
      Effect.gen(function* () {
        const { fired, reactivity } = yield* invalidations;
        const [events] = keys.events(datekit);

        reactivity.registerUnsafe([events ?? ""], () => {
          fired.push("events");
        });

        yield* tab(
          () => Stream.never,
          reactivity,
          AsyncResult.success([
            ProjectEvent.cases.Claimed.make({
              ask: parseIso,
              at,
              claimant: Handle.make("alice"),
              seq: 1,
            }),
            ProjectEvent.cases.Judged.make({
              ask: parseIso,
              at,
              head,
              outcome: Outcome.cases.Checking.make({ stage: "merge" }),
              seq: 2,
            }),
          ])
        );

        const heard = yield* firedNow(fired);

        yield* runUntil(() => fired.length > 0);

        expect({ after: [...fired], heard }).toStrictEqual({
          after: [],
          heard: [askKey, projectKey],
        });
      })
  );

  it.effect(
    "reads the replay again on each event the stream brings, and on each poll",
    () =>
      Effect.gen(function* () {
        const reactivity = yield* Reactivity.make;
        const fired: string[] = [];
        const [events] = keys.events(datekit);

        reactivity.registerUnsafe([events ?? ""], () => {
          fired.push("events");
        });

        const heard = yield* Queue.unbounded<ProjectEvent>();
        const connects = yield* Ref.make(0);

        yield* tab(
          () =>
            Stream.unwrap(
              Effect.map(
                Ref.getAndUpdate(connects, (count) => count + 1),
                (count) =>
                  count === 0
                    ? Stream.fromQueue(heard).pipe(Stream.take(1))
                    : Stream.fail("no framed /rpc here")
              )
            ),
          reactivity
        );

        yield* Queue.offer(
          heard,
          ProjectEvent.cases.Warned.make({ ask: parseIso, at, seq: 1 })
        );

        const onEvent = yield* firedNow(fired);

        yield* TestClock.adjust(POLL_MS);
        yield* runUntil(() => Ref.getUnsafe(connects) > 1);
        yield* TestClock.adjust(POLL_MS);

        expect({ onEvent, onPoll: yield* firedNow(fired) }).toStrictEqual({
          onEvent: ["events"],
          onPoll: ["events"],
        });
      })
  );

  it.effect(
    "follows from the first event when the replay could not be read",
    () =>
      Effect.gen(function* () {
        const { reactivity } = yield* invalidations;
        const asked = yield* Ref.make<readonly number[]>([]);

        yield* tab(
          (since) =>
            Stream.unwrap(
              Effect.as(
                Ref.update(asked, (all) => [...all, since]),
                Stream.never
              )
            ),
          reactivity,
          AsyncResult.fail(new UnknownProject({ project: datekit }))
        );

        yield* runUntil(() => Ref.getUnsafe(asked).length > 0);

        expect(yield* Ref.get(asked)).toStrictEqual([0]);
      })
  );
});
