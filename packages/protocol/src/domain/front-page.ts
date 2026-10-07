import { Schema } from "effect";

import { ProjectName } from "../ids.ts";
import { Posture } from "../posture.ts";
import { AskListing } from "./ask.ts";

/** One open ask on the front page: the cross-project list of asks a viewer may take. */
export const FrontPageEntry = Schema.Struct({
  ask: AskListing,
  posture: Posture,
  project: ProjectName,
  /** Whether this viewer may claim it: its reserve, their vouch and their record. */
  takeable: Schema.Boolean,
});

export type FrontPageEntry = typeof FrontPageEntry.Type;

/** One project, as the list of projects shows it. */
export const ProjectListing = Schema.Struct({
  /** When the platform last landed on its main; absent before the first landing. */
  landedAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
  openAsks: Schema.Int,
  posture: Posture,
  project: ProjectName,
});

export type ProjectListing = typeof ProjectListing.Type;
