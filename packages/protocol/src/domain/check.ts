import { Schema } from "effect";

import { RatchetName, RepoPath } from "../ids.ts";
import { Command, JsonPath, SymbolName } from "./common.ts";

export const CheckSpec = Schema.TaggedUnion({
  LintToZero: {
    command: Command,
    rule: Schema.NonEmptyString,
    territory: Schema.optionalKey(Schema.NonEmptyString),
  },
  /** Every use of `from` moves to `to`; `count` prints `{"total": n, "byModule": {...}}`. */
  Migrate: {
    count: Command,
    from: SymbolName,
    to: Schema.optionalKey(SymbolName),
  },
  Ratchet: { ratchet: RatchetName },
  RedThenGreen: { path: RepoPath },
  SymbolAbsent: { count: Command, symbol: SymbolName },
});

export type CheckSpec = typeof CheckSpec.Type;

export const Strength = Schema.Literals(["assertion", "nullAnswer"]);

export type Strength = typeof Strength.Type;

export const RatchetMeasure = Schema.TaggedUnion({
  Count: { command: Command, rule: Schema.optionalKey(Schema.NonEmptyString) },
  Metric: { command: Command, path: JsonPath },
});

export type RatchetMeasure = typeof RatchetMeasure.Type;

export const RatchetSpec = Schema.Struct({
  measure: RatchetMeasure,
  name: RatchetName,
  territory: Schema.optionalKey(Schema.NonEmptyString),
});

export type RatchetSpec = typeof RatchetSpec.Type;
