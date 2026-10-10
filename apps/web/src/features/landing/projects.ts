/**
 * The landing's projects: the platform's list, as the rail reads it in the
 * browser after the page is up (the same read, so no second request), and
 * what the page says while it comes or when it does not. The page is the
 * same for everyone, so the edge may keep it.
 */
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

/** The projects the page names; the rest are a step away, at `/asks`. */
export const PROJECTS_SHOWN = 8;

/** The projects block: the first few on the platform, still coming, or that the list did not come. */
export const LandingProjects = Schema.TaggedUnion({
  Listed: { projects: Schema.Array(ProjectListing) },
  Pending: {},
  Unreachable: {},
});

export type LandingProjects = typeof LandingProjects.Type;

/** The list's read, as the block says it. */
export const landingProjects = (
  read: AsyncResult.AsyncResult<
    { readonly projects: readonly ProjectListing[] },
    unknown
  >
): LandingProjects =>
  AsyncResult.match(read, {
    onFailure: () => LandingProjects.cases.Unreachable.make({}),
    onInitial: () => LandingProjects.cases.Pending.make({}),
    onSuccess: ({ value }) =>
      LandingProjects.cases.Listed.make({
        projects: value.projects.slice(0, PROJECTS_SHOWN),
      }),
  });
