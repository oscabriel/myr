import { Schema } from "effect";

import { Handle } from "../ids.ts";

export const CreditRole = Schema.Literals([
  "Asked-by",
  "Signed-off-by",
  "Decided-by",
  "Mentored-by",
  "Finished-by",
  "Advised-by",
  "Released-by",
]);

export type CreditRole = typeof CreditRole.Type;

export const Credit = Schema.Struct({ handle: Handle, role: CreditRole });

export type Credit = typeof Credit.Type;

/** An `Assisted-by:` trailer: a disclosure, never credit, which goes only to people. */
export const AgentTrailer = Schema.Struct({
  harness: Schema.NonEmptyString,
  model: Schema.optionalKey(Schema.NonEmptyString),
  verified: Schema.Boolean,
});

export type AgentTrailer = typeof AgentTrailer.Type;
