import { ProjectListing } from "@repo/protocol/domain/front-page";
import { Schema } from "effect";

import { leadingProjects, PROJECTS_SHOWN } from "../shared/project-order.ts";

export const LandingProjects = Schema.TaggedUnion({
  Listed: { projects: Schema.Array(ProjectListing) },
  Unreachable: {},
});

export type LandingProjects = typeof LandingProjects.Type;

export const listedProjects = (
  projects: readonly ProjectListing[]
): LandingProjects =>
  LandingProjects.cases.Listed.make({
    projects: leadingProjects(projects, PROJECTS_SHOWN),
  });
