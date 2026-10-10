/**
 * The landing's projects: the platform's list, read on the server as
 * nobody by the route's loader, so the page arrives with them for every
 * reader (a crawler and a reader with no script included) and the edge may
 * keep it; and what the page says when the list did not come. The list
 * ignores the caller, so nobody's read is everyone's.
 */
import { Client } from "@repo/protocol/contracts";
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { Effect, Schema } from "effect";

/** The projects the page names; the rest are a step away, at `/asks`. */
export const PROJECTS_SHOWN = 8;

/** The projects block: the first few on the platform, or that the list did not come. */
export const LandingProjects = Schema.TaggedUnion({
  Listed: { projects: Schema.Array(ProjectListing) },
  Unreachable: {},
});

export type LandingProjects = typeof LandingProjects.Type;

/** The block from a list that came. */
export const listedProjects = (
  projects: readonly ProjectListing[]
): LandingProjects =>
  LandingProjects.cases.Listed.make({
    projects: projects.slice(0, PROJECTS_SHOWN),
  });

/**
 * The list's read on the server: the first few projects, or, when the
 * platform did not answer (a refusal, or a call that died on the way), the
 * block that says so. It never fails: the page leads to the asks either way.
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
