/**
 * What a code page's 404 carries when the path it named is missing at a
 * revision that exists: the platform's refusal (`UnknownPath`), and the
 * nearest folder above the path that does exist there, so the page lands
 * softly on that folder with the refusal's own words as its notice. Any
 * other refusal (no such project, revision or commit) travels alone, as
 * `Refusals`.
 */
import { TreeListing } from "@repo/protocol/domain/code";
import { ProjectName } from "@repo/protocol/ids";
import { Schema } from "effect";

import { Refusals } from "../shared/refusals.ts";

export const SoftLanding = Schema.Struct({
  nearest: TreeListing,
  now: Schema.DateTimeUtcFromString,
  project: ProjectName,
  refusals: Refusals,
  rev: Schema.String,
});

export type SoftLanding = typeof SoftLanding.Type;
