/**
 * The landing's projects block: the first few on the platform, or that the
 * list did not come. The read that fills it is `read.ts`'s.
 */
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { Schema } from "effect";

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
