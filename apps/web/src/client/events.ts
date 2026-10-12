// Over JSON the platform replays the kept events in one response and ends; only the framed `/rpc` keeps the stream open.
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

const RECENT = 20;

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

export const recentLandings = (
  events: readonly ProjectEvent[]
): readonly LandingView[] =>
  events
    .flatMap((event) =>
      ProjectEvent.guards.Landed(event) ? [event.landing] : []
    )
    .toReversed()
    .slice(0, RECENT);

export const recentLandingsAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    Atom.mapResult(projectEventsAtom(project), recentLandings)
  )
);
