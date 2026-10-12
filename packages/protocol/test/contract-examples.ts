import { Schema } from "effect";

import wire from "./fixtures/contracts.json" with { type: "json" };

export const Example = Schema.Struct({
  payload: Schema.Json,
  success: Schema.Json,
});

export type Example = typeof Example.Type;

const Fixture = Schema.Struct({
  examples: Schema.Record(Schema.String, Example),
});

export const examples: ReadonlyMap<string, Example> = new Map(
  Object.entries(Schema.decodeSync(Fixture)(wire).examples)
);
