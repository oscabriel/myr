import { ProjectListing } from "@repo/protocol/domain/front-page";
import { Schema } from "effect";

export const LandingProjects = Schema.TaggedUnion({
  Listed: { projects: Schema.Array(ProjectListing) },
  Unreachable: {},
});

export type LandingProjects = typeof LandingProjects.Type;
