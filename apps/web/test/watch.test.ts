/**
 * The page's live view: `watchAtom(project)`, mounted by the
 * project and answer pages, follows the project's events and invalidates
 * the keys each one changes, so the page's reads fetch again; a stream
 * that fails before it hears anything turns into a poll every `POLL_MS`.
 * Each test runs the atom in a registry of its own, over a stub stream
 * and the test's own `Reactivity`, on the TestClock.
 */
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
import { Clock, DateTime, Effect, Layer, Queue, Ref, Stream } from "effect";
import { Atom, AtomRegistry, Reactivity } from "effect/reactivity";
import { TestClock } from "effect/testing";

import { keys } from "../src/client/keys.ts";
import {
  POLL_MS,
  ProjectWatch,
  watchAtom,
  watchRuntime,
} from "../src/client/watch.ts";

const datekit = ProjectName.make("datekit");

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

/** The page's two kinds of key: the project's, and its ask's own. */
const projectKey = "project";

const askKey = "ask";

/**
 * The keys invalidated so far, by kind, each once per invalidation: the
 * test's `Reactivity`, with one listener on the project's key and one on
 * the ask's own.
 */
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

/**
 * A registry standing for one browser tab: `watchAtom`'s runtime follows
 * `follow` and invalidates through `reactivity`, its time the TestClock's.
 */
const tab = (
  follow: (since: number) => Stream.Stream<ProjectEvent, string>,
  reactivity: Reactivity.Reactivity
) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;

    const registry = yield* Effect.acquireRelease(
      Effect.sync(() =>
        AtomRegistry.make({
          initialValues: [
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

/** Lets the atom's fiber run until `done` holds, or long enough that it would have. */
const runUntil = (done: () => boolean) =>
  Effect.yieldNow.pipe(Effect.repeat({ times: 200, until: done }));

/** What `fired` holds once something has fired, sorted; then it is emptied. */
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
});
