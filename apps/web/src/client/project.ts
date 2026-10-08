import { ProjectEvent } from "@repo/protocol/domain/event";
/**
 * A project page's reads (spec §3.2): its open asks (`listAsks`) and its
 * recent landings, which come from the `watch` replay (spec §3.4), not a
 * contract of their own. Both are read once per page; issue 510 makes them
 * live. Each renders as waiting on the server, and the browser calls `/rpc`
 * (see `front.ts`).
 *
 * The landings read `watch` from the start of the project's events
 * (`since: 0`) to the end of the replay: until 510 keeps the stream open,
 * the platform's `watch` ends there, and over HTTP with JSON (not framed)
 * the whole replay arrives as one response. The atom keeps the `Landed`
 * events, newest first.
 */
import type { LandingView } from "@repo/protocol/domain/landing";
import type { ProjectName } from "@repo/protocol/ids";
import { Effect, Stream } from "effect";
import { Atom } from "effect/reactivity";

import { ContractsClient } from "../surfaces.ts";
import { keys } from "./keys.ts";

/** How many landings a project's page shows. */
const RECENT = 20;

export const asksAtom = Atom.family((project: ProjectName) =>
  Atom.withServerValueInitial(
    ContractsClient.query(
      "listAsks",
      { project },
      { reactivityKeys: keys.project(project) }
    )
  )
);

/** The landings among a project's events, newest first, at most `RECENT`. */
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
    ContractsClient.runtime.factory.withReactivity(keys.project(project))(
      ContractsClient.runtime.atom(
        Effect.gen(function* () {
          const client = yield* ContractsClient;

          const events = yield* Stream.runCollect(
            client("watch", { project, since: 0 })
          );

          return recentLandings(events);
        })
      )
    )
  )
);
