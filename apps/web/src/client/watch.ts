/**
 * A page's live view: `watchAtom(project)` follows
 * the project's `watch` stream over the framed `/rpc` and invalidates the
 * keys each event changes (`keysOf`), so the page's own reads (`listAsks`,
 * `verdict`, the landings) fetch again. It keeps nothing but the last
 * number it heard.
 *
 * - A stream that ends, or fails after it heard something, is followed
 *   again `POLL_MS` later, from the last number heard: nothing is missed
 *   and nothing is heard twice.
 * - A stream that fails before it hears anything (no framed `/rpc`, as in
 *   the dev world, or a platform that cannot stream) turns the page to
 *   polling: every `POLL_MS` the project's keys are invalidated, and since
 *   an ask's keys include its project's (`keys.ts`), the answer page's
 *   verdict fetches again too.
 *
 * The project and answer pages mount it (`useAtomMount`), so it runs only
 * in the browser, from the page's mount to its unmount. The first events a
 * stream hears are the kept ones a page has already read, so a new watcher
 * makes the page read once more; that read also catches whatever happened
 * between the page's first read and the stream's start.
 */
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { ProjectName } from "@repo/protocol/ids";
import {
  Array,
  Context,
  Effect,
  Exit,
  Layer,
  Ref,
  Schedule,
  Stream,
} from "effect";
import { constVoid } from "effect/Function";
import { Atom, Reactivity } from "effect/reactivity";

import { framedClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

/** How long a page waits before it follows again, or between polls. */
export const POLL_MS = 5000;

/** Where a page hears its project's events, from a sequence number on. */
export class ProjectWatch extends Context.Service<
  ProjectWatch,
  {
    readonly follow: (
      project: ProjectName,
      since: number
    ) => Stream.Stream<ProjectEvent, unknown>;
  }
>()("web/ProjectWatch") {}

/** `watch` over the framed `/rpc`. */
const framedWatch = Layer.effect(
  ProjectWatch,
  Effect.map(framedClient, (client) =>
    ProjectWatch.of({
      follow: (project, since) => client.watch({ project, since }),
    })
  )
);

/** The runtime `watchAtom` runs on; a test gives it a stub `ProjectWatch`. */
export const watchRuntime = Atom.runtime(framedWatch);

/** The keys an event of `project` changes. */
export const keysOf = (
  project: ProjectName,
  event: ProjectEvent
): readonly string[] =>
  ProjectEvent.match(event, {
    AskClosed: () => keys.project(project),
    AskOpened: () => keys.project(project),
    Claimed: () => keys.project(project),
    Decided: () => keys.project(project),
    Judged: ({ ask }) => keys.ask(project, ask),
    Landed: () => [
      ...keys.project(project),
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

/** `project` followed for as long as it runs: the stream while it works, then the poll. */
const followed = (project: ProjectName) =>
  Effect.gen(function* () {
    const watch = yield* ProjectWatch;
    const reactivity = yield* Reactivity.Reactivity;
    const last = yield* Ref.make(0);

    /** One stream from the last number heard, to its end: whether it failed before it heard anything. */
    const once = Effect.gen(function* () {
      const heard = yield* Ref.make(false);

      const ended = yield* watch.follow(project, yield* Ref.get(last)).pipe(
        Stream.runForEachArray((events) =>
          Effect.gen(function* () {
            yield* reactivity.invalidate(
              Array.dedupe(events.flatMap((event) => keysOf(project, event)))
            );
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
      .invalidate(keys.project(project))
      .pipe(Effect.delay(POLL_MS), Effect.forever);
  });

/**
 * A page's live view of `project`: mounted, it follows the project's
 * events and invalidates the keys they change. Its value says nothing.
 */
export const watchAtom = Atom.family((project: ProjectName) =>
  Atom.map(watchRuntime.atom(followed(project)), constVoid)
);
