/**
 * A project's events, read once per page and folded: the `watch` replay
 * from the first event, which every page that needs who holds an ask, its
 * rounds, a family's progress or the recent landings reads the same way.
 * No contract of its own: the fold reads only what `watch` already sends.
 *
 * - `projectEventsAtom(project)` holds the replay. Over JSON the platform
 *   replays the kept events in one response and ends (only the framed
 *   `/rpc` keeps the stream open), and the page's live view (`watch.ts`)
 *   reads it again on each event, so it stays current.
 * - The derivations are pure and live with the views that draw them
 *   (`features/shared/ask-progress.ts`): `askStates` (per ask), `whoseMove`,
 *   `familyMarks`, `stampsFrom` (when a landing that happened while the page
 *   was open earns its stamp); `recentLandings` is here, beside its atom.
 */
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { ProjectName } from "@repo/protocol/ids";
import { Effect, Stream } from "effect";
import { Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

export {
  askStates,
  familyMarks,
  lastSeq,
  stampsFrom,
  whoseMove,
} from "../features/shared/ask-progress.ts";

export type {
  AskProgress,
  Family,
  Mark,
  Move,
  Round,
} from "../features/shared/ask-progress.ts";

/** How many landings a project's page shows. */
const RECENT = 20;

/**
 * The project's events, replayed from the first; read again on each event
 * the page's live view hears, and on each of its polls (`keys.events`).
 */
export const projectEventsAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    ContractsClient.runtime.factory.withReactivity(keys.events(project))(
      ContractsClient.runtime.atom(
        Effect.gen(function* () {
          const client = yield* ContractsClient;

          const events: readonly ProjectEvent[] = yield* Stream.runCollect(
            client("watch", { project, since: 0 })
          );

          return events;
        })
      )
    )
  )
);

/** The landings among a project's events, newest first, at most twenty. */
export const recentLandings = (
  events: readonly ProjectEvent[]
): readonly LandingView[] =>
  events
    .flatMap((event) =>
      ProjectEvent.guards.Landed(event) ? [event.landing] : []
    )
    .toReversed()
    .slice(0, RECENT);

/** A project's recent landings, from the one replay its page reads. */
export const recentLandingsAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    Atom.mapResult(projectEventsAtom(project), recentLandings)
  )
);
