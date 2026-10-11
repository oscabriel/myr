/**
 * The landing's read on the server, as nobody, by the route's loader: the
 * platform's project list, so the page arrives with its projects for every
 * reader (a crawler and a reader with no script included) and the edge may
 * keep it. The list ignores the caller, so nobody's read is everyone's.
 */
import { Client } from "@repo/protocol/contracts";
import { Effect } from "effect";

import { LandingProjects, listedProjects } from "./projects.ts";

/**
 * The first few projects, or, when the platform did not answer (a refusal,
 * or a call that died on the way), the block that says so. It never fails:
 * the page leads to the asks either way.
 */
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
