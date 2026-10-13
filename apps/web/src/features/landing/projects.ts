import { ProjectListing } from "@repo/protocol/domain/front-page";
import { Schema } from "effect";

import { leadingProjects, PROJECTS_SHOWN } from "../shared/project-order.ts";

export const LandingProjects = Schema.TaggedUnion({
  Listed: { projects: Schema.Array(ProjectListing) },
  Unreachable: {},
});

export type LandingProjects = typeof LandingProjects.Type;

/** The projects taking the most answers first, the first `shown` of them. */
export const listedProjects = (
  projects: readonly ProjectListing[],
  shown: number = PROJECTS_SHOWN
): LandingProjects =>
  LandingProjects.cases.Listed.make({
    projects: leadingProjects(projects, shown),
  });
