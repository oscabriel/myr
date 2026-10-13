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

/** A description longer than this is cut where it is made, so a card holds one line. */
export const PROJECT_DESCRIPTION_CAP = 160;

/** One line about a project: its README's first paragraph, as plain text. */
export const ProjectDescription = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isTrimmed(),
  Schema.isMaxLength(PROJECT_DESCRIPTION_CAP)
).pipe(Schema.brand("ProjectDescription"));

export type ProjectDescription = typeof ProjectDescription.Type;

export const ProjectListing = Schema.Struct({
  description: Schema.optionalKey(ProjectDescription),
  landedAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
  openAsks: Schema.Int,
  posture: Posture,
  project: ProjectName,
});

export type ProjectListing = typeof ProjectListing.Type;
