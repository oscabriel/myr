/**
 * Builders for an ask's check and for a ratchet's measure. Each checks its
 * input against protocol's schema at the call and returns plain data.
 */
import {
  CheckSpec,
  RatchetMeasure as Measure,
} from "@repo/protocol/domain/check";
import { Schema, Struct } from "effect";

type CheckSpecEncoded = typeof CheckSpec.Encoded;

/**
 * An ask's check as the config folder states it: plain data, by check kind.
 * `CheckSpecInput<"RedThenGreen">` narrows it to one check kind.
 */
export type CheckSpecInput<
  Tag extends CheckSpecEncoded["_tag"] = CheckSpecEncoded["_tag"],
> = Extract<CheckSpecEncoded, { readonly _tag: Tag }>;

/** How a ratchet measures its number, as plain data: a lint count, or a number in a command's JSON. */
export type RatchetMeasure = typeof Measure.Encoded;

const { LintToZero, Migrate, Ratchet, RedThenGreen } = CheckSpec.cases;

const { Count, Metric } = Measure.cases;

// Each case's fields without its tag: what a builder checks before it makes
// the case, so a malformed input fails with a Schema issue at the call.
const lintToZeroFields = Schema.Struct(
  Struct.omit(LintToZero.fields, ["_tag"])
);

const migrateFields = Schema.Struct(Struct.omit(Migrate.fields, ["_tag"]));

const ratchetFields = Schema.Struct(Struct.omit(Ratchet.fields, ["_tag"]));

const redThenGreenFields = Schema.Struct(
  Struct.omit(RedThenGreen.fields, ["_tag"])
);

const countFields = Schema.Struct(Struct.omit(Count.fields, ["_tag"]));

const metricFields = Schema.Struct(Struct.omit(Metric.fields, ["_tag"]));

/** The builders for an ask's check, one per check kind, and for a ratchet's measure. */
export const check = {
  /**
   * A lint rule's count goes to zero: red while `command` (the project's own
   * lint, with JSON output) reports `rule` on main.
   */
  lintToZero: (rule: string, command: string): CheckSpecInput<"LintToZero"> =>
    Schema.encodeSync(LintToZero)(
      LintToZero.make(Schema.decodeSync(lintToZeroFields)({ command, rule }))
    ),
  /**
   * Every use of `from` moves to `to` (or is gone, without `to`). `count` is
   * the project's own command that prints `{"total": n, "byModule": {...}}`.
   */
  migrate: (spec: {
    readonly count: string;
    readonly from: string;
    readonly to?: string;
  }): CheckSpecInput<"Migrate"> =>
    Schema.encodeSync(Migrate)(
      Migrate.make(Schema.decodeSync(migrateFields)(spec))
    ),
  /** Ratchets: a counted budget per territory that answers may lower and never raise. */
  ratchet: {
    /**
     * Counts lint findings in the project's own lint JSON output
     * (oxlint or ESLint), for one rule or for all.
     */
    count: (
      command: string,
      options?: { readonly rule?: string }
    ): RatchetMeasure =>
      Schema.encodeSync(Count)(
        Count.make(Schema.decodeSync(countFields)({ command, ...options }))
      ),
    /** The check of a ratchet ask: the named ratchet goes down. */
    down: (ratchet: string): CheckSpecInput<"Ratchet"> =>
      Schema.encodeSync(Ratchet)(
        Ratchet.make(Schema.decodeSync(ratchetFields)({ ratchet }))
      ),
    /** Reads one number at `path` (a JSON pointer: `/total`) in the command's JSON output. */
    metric: (
      command: string,
      options: { readonly path: string }
    ): RatchetMeasure =>
      Schema.encodeSync(Metric)(
        Metric.make(
          Schema.decodeSync(metricFields)({ command, path: options.path })
        )
      ),
  },
  /**
   * One check file fails on main by an assertion, and passes on the answer.
   * The run block's `test` command runs it, with `path` for `{path}`.
   */
  redThenGreen: (path: string): CheckSpecInput<"RedThenGreen"> =>
    Schema.encodeSync(RedThenGreen)(
      RedThenGreen.make(Schema.decodeSync(redThenGreenFields)({ path }))
    ),
};
