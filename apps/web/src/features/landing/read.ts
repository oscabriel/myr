/**
 * The list ignores the caller, so nobody's read is everyone's and the edge may
 * keep it.
 */
import { Client } from "@repo/protocol/contracts";
import { Effect } from "effect";

import { LandingProjects, listedProjects } from "./projects.ts";

export const readLandingProjects: Effect.Effect<
  LandingProjects,
  never,
  Client
> = Effect.gen(function* () {
  const client = yield* Client;
  const { projects } = yield* client.listProjects({});

  return listedProjects(projects);
}).pipe(
  Effect.catchCause(() =>
    Effect.succeed(LandingProjects.cases.Unreachable.make({}))
  )
);
