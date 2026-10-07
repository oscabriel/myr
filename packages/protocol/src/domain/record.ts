import { Schema } from "effect";

import { ProjectName } from "../ids.ts";
import { CreditRole } from "./credit.ts";

/**
 * How many landings credit a person in one role, in one area of one project.
 * A count by role and area, never a score.
 */
export const CreditSummary = Schema.Struct({
  area: Schema.NonEmptyString,
  count: Schema.Int,
  project: ProjectName,
  role: CreditRole,
});

export type CreditSummary = typeof CreditSummary.Type;
