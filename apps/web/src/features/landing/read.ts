/**
 * The list ignores the caller, so nobody's read is everyone's and the edge may
 * keep it.
 */
import { Client } from "@repo/protocol/contracts";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { DateTime, Effect } from "effect";

import { landedLatest, LandingNow } from "./landing-now.ts";
import { LandingProjects, listedProjects } from "./projects.ts";

const readProjects = (
  order: (projects: readonly ProjectListing[]) => LandingProjects
): Effect.Effect<LandingProjects, never, Client> =>
  Effect.gen(function* () {
    const client = yield* Client;
    const { projects } = yield* client.listProjects({});

    return order(projects);
  }).pipe(
    Effect.catchCause(() =>
      Effect.succeed(LandingProjects.cases.Unreachable.make({}))
    )
  );

/** Every public project, in the landing's order. */
export const readEveryProject = readProjects((projects) =>
  listedProjects(projects, projects.length)
);

/** The landing's "landing now": the projects that landed last, read at one instant. */
export const readLandingNow: Effect.Effect<LandingNow, never, Client> =
  Effect.gen(function* () {
    const client = yield* Client;
    const { projects } = yield* client.listProjects({});

    return LandingNow.cases.Listed.make({
      now: yield* DateTime.now,
      projects: landedLatest(projects),
    });
  }).pipe(
    Effect.catchCause(() =>
      Effect.succeed(LandingNow.cases.Unreachable.make({}))
    )
  );
