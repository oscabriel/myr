/**
 * The list ignores the caller, so nobody's read is everyone's and the edge may
 * keep it.
 */
import { Client } from "@repo/protocol/contracts";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { Effect } from "effect";

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

/** The landing's few. */
export const readLandingProjects = readProjects((projects) =>
  listedProjects(projects)
);

/** Every public project, as the platform lists them: Explore groups and orders them. */
export const readEveryProject = readProjects((projects) =>
  LandingProjects.cases.Listed.make({ projects })
);
