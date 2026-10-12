// Follows from the replay's last number, so a new watcher never hears a kept event twice. A stream that fails
// before it hears anything (no framed `/rpc`, as in the dev world) turns the page to polling the project's keys.
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { ProjectName } from "@repo/protocol/ids";
import {
  Array,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Schedule,
  Stream,
} from "effect";
import { constVoid } from "effect/Function";
import { Atom, Reactivity } from "effect/reactivity";

import { framedClient, sharedRuntime } from "../surfaces.ts";
import { lastSeq, projectEventsAtom } from "./events.ts";
import { keys } from "./keys.ts";

export const POLL_MS = 5000;

export class ProjectWatch extends Context.Service<
  ProjectWatch,
  {
    readonly follow: (
      project: ProjectName,
      since: number
    ) => Stream.Stream<ProjectEvent, unknown>;
  }
>()("web/ProjectWatch") {}

const framedWatch = Layer.effect(
  ProjectWatch,
  Effect.map(framedClient, (client) =>
    ProjectWatch.of({
      follow: (project, since) => client.watch({ project, since }),
    })
  )
);

export const watchRuntime = sharedRuntime(framedWatch);

export const keysOf = (
  project: ProjectName,
  event: ProjectEvent
): readonly string[] =>
  ProjectEvent.match(event, {
    AskClosed: () => [...keys.project(project), ...keys.front()],
    AskOpened: () => [...keys.project(project), ...keys.front()],
    Claimed: () => keys.project(project),
    Decided: () => keys.project(project),
    Judged: ({ ask }) => keys.ask(project, ask),
    Landed: () => [
      ...keys.project(project),
      ...keys.front(),
      ...keys.code(project),
      ...keys.policy(project),
    ],
    Lapsed: () => keys.project(project),
    LedgerAppended: () => keys.ledger(project),
    ProposalDrafted: ({ proposal }) => keys.proposal(project, proposal),
    ProposalOpened: () => keys.project(project),
    Pushed: ({ ask }) => keys.ask(project, ask),
    Released: () => keys.project(project),
    Warned: ({ ask }) => keys.ask(project, ask),
  });

const keysOfAll =
  (project: ProjectName) =>
  (events: readonly ProjectEvent[]): readonly string[] =>
    Array.dedupe(events.flatMap((event) => keysOf(project, event)));

const followed = <E>(
  project: ProjectName,
  replay: Effect.Effect<readonly ProjectEvent[], E>
) =>
  Effect.gen(function* () {
    const watch = yield* ProjectWatch;
    const reactivity = yield* Reactivity.Reactivity;
    const kept = yield* Effect.option(replay);

    const last = yield* Ref.make(
      Option.match(kept, { onNone: () => 0, onSome: lastSeq })
    );

    // The page's reads, once, for what came between them and the replay.
    yield* reactivity.invalidate(
      Option.match(kept, { onNone: () => [], onSome: keysOfAll(project) })
    );

    const once = Effect.gen(function* () {
      const heard = yield* Ref.make(false);

      const ended = yield* watch.follow(project, yield* Ref.get(last)).pipe(
        Stream.runForEachArray((events) =>
          Effect.gen(function* () {
            yield* reactivity.invalidate([
              ...keysOfAll(project)(events),
              ...keys.events(project),
            ]);
            yield* Ref.set(last, Array.lastNonEmpty(events).seq);
            yield* Ref.set(heard, true);
          })
        ),
        Effect.exit
      );

      return Exit.isFailure(ended) && !(yield* Ref.get(heard));
    });

    yield* once.pipe(
      Effect.repeat({
        schedule: Schedule.spaced(POLL_MS),
        until: (failedAtConnect) => failedAtConnect,
      })
    );

    return yield* reactivity
      .invalidate([...keys.project(project), ...keys.events(project)])
      .pipe(Effect.delay(POLL_MS), Effect.forever);
  });

export const watchAtom = Atom.family((project: ProjectName) =>
  Atom.map(
    watchRuntime.atom((get) =>
      // Read once, not followed: a new replay must not start the stream over.
      followed(project, get.resultOnce(projectEventsAtom(project)))
    ),
    constVoid
  )
);
