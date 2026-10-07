import { Schema } from "effect";

import { Handle } from "../ids.ts";

/** The human roles a landing credits, each one a trailer. */
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

/** One trailer on a landing, naming a person in one role. */
export const Credit = Schema.Struct({ handle: Handle, role: CreditRole });

export type Credit = typeof Credit.Type;

/**
 * The agent a person worked through, as an `Assisted-by:` trailer. It is a
 * disclosure, never credit: credit goes only to people.
 */
export const AgentTrailer = Schema.Struct({
  harness: Schema.NonEmptyString,
  model: Schema.optionalKey(Schema.NonEmptyString),
  /** Whether the platform confirmed it, or only read it from the answer's commits. */
  verified: Schema.Boolean,
});

export type AgentTrailer = typeof AgentTrailer.Type;
