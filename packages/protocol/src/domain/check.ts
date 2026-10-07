import { Schema } from "effect";

import { RatchetName, RepoPath } from "../ids.ts";
import { Command, JsonPath, SymbolName } from "./common.ts";

/**
 * An ask's check: what judges an answer to it, by check kind. `RedThenGreen`
 * runs the run block's `test` on one file; the others count something with a
 * command of the project's own.
 */
export const CheckSpec = Schema.TaggedUnion({
  /** A lint rule's count goes to zero in the territory. */
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
  /** A named ratchet goes down. */
  Ratchet: { ratchet: RatchetName },
  /** One check file fails on main by an assertion, and passes on the answer. */
  RedThenGreen: { path: RepoPath },
  /** The last step of a migrate: `symbol` is gone. */
  SymbolAbsent: { count: Command, symbol: SymbolName },
});

export type CheckSpec = typeof CheckSpec.Type;

/**
 * How strong an ask's check must be: failing on main by an assertion, or
 * also failing a null answer.
 */
export const Strength = Schema.Literals(["assertion", "nullAnswer"]);

export type Strength = typeof Strength.Type;

/** How a ratchet measures its number: a lint count, or a number in a command's JSON. */
export const RatchetMeasure = Schema.TaggedUnion({
  /** Counts lint findings from oxlint or ESLint JSON, for one rule or all. */
  Count: { command: Command, rule: Schema.optionalKey(Schema.NonEmptyString) },
  /** Reads one number at `path` in the command's JSON output. */
  Metric: { command: Command, path: JsonPath },
});

export type RatchetMeasure = typeof RatchetMeasure.Type;

/**
 * A ratchet: a counted budget per territory that answers may lower and never
 * raise; only a decider raises it.
 */
export const RatchetSpec = Schema.Struct({
  measure: RatchetMeasure,
  name: RatchetName,
  territory: Schema.optionalKey(Schema.NonEmptyString),
});

export type RatchetSpec = typeof RatchetSpec.Type;
