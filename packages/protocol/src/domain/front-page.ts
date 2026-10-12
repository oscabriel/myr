import { Schema } from "effect";

import { ProjectName } from "../ids.ts";
import { Posture } from "../posture.ts";
import { AskListing } from "./ask.ts";

export const FrontPageEntry = Schema.Struct({
  ask: AskListing,
  posture: Posture,
  project: ProjectName,
  takeable: Schema.Boolean,
});

export type FrontPageEntry = typeof FrontPageEntry.Type;

export const ProjectListing = Schema.Struct({
  landedAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
  openAsks: Schema.Int,
  posture: Posture,
  project: ProjectName,
});

export type ProjectListing = typeof ProjectListing.Type;
