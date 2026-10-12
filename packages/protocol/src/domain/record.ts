import { Schema } from "effect";

import { ProjectName } from "../ids.ts";
import { CreditRole } from "./credit.ts";

export const CreditSummary = Schema.Struct({
  area: Schema.NonEmptyString,
  count: Schema.Int,
  project: ProjectName,
  role: CreditRole,
});

export type CreditSummary = typeof CreditSummary.Type;
