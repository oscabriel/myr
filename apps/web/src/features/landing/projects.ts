/**
 * The landing's projects block: the eight that lead (the most open asks
 * first, a tie by name), or that the list did not come. The read that
 * fills it is `read.ts`'s.
 */
import { ProjectListing } from "@repo/protocol/domain/front-page";
import { Schema } from "effect";

import { leadingProjects, PROJECTS_SHOWN } from "../shared/project-order.ts";

/** The projects block: the ones that lead, or that the list did not come. */
export const LandingProjects = Schema.TaggedUnion({
  Listed: { projects: Schema.Array(ProjectListing) },
  Unreachable: {},
});

export type LandingProjects = typeof LandingProjects.Type;

/** The block from a list that came: the eight that lead. */
export const listedProjects = (
  projects: readonly ProjectListing[]
): LandingProjects =>
  LandingProjects.cases.Listed.make({
    projects: leadingProjects(projects, PROJECTS_SHOWN),
  });
