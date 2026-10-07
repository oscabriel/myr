/**
 * One example payload and one example success for every contract, encoded as
 * they travel on the wire (`fixtures/contracts.json`), by contract tag. A
 * stream's success is one of its elements.
 */
import { Schema } from "effect";

import wire from "./fixtures/contracts.json" with { type: "json" };

/** One contract's example, as JSON carries it. */
export const Example = Schema.Struct({
  payload: Schema.Json,
  success: Schema.Json,
});

export type Example = typeof Example.Type;

const Fixture = Schema.Struct({
  examples: Schema.Record(Schema.String, Example),
});

/** Each contract's example, by its tag. */
export const examples: ReadonlyMap<string, Example> = new Map(
  Object.entries(Schema.decodeSync(Fixture)(wire).examples)
);
