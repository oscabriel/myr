/**
 * A project page's reads: its open asks (`listAsks`) and its
 * recent landings, which come from the `watch` replay, not a
 * contract of their own. Both read again when the project's key is
 * invalidated, which the page's live view (`watch.ts`) does on
 * each event. Each renders as waiting on the server, and the browser calls
 * `/rpc` (see `front.ts`).
 *
 * The landings read `watch` from the start of the project's events
 * (`since: 0`) over JSON, where the platform replays the kept events in
 * one response and ends (only the framed `/rpc` keeps the stream open).
 * The atom keeps the `Landed` events, newest first.
 */
import { ProjectEvent } from "@repo/protocol/domain/event";
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
