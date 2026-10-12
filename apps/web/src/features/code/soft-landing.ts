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
