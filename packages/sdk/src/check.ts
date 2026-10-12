import {
  CheckSpec,
  RatchetMeasure as Measure,
} from "@repo/protocol/domain/check";
import { Schema, Struct } from "effect";

type CheckSpecEncoded = typeof CheckSpec.Encoded;

/** `CheckSpecInput<"RedThenGreen">` narrows it to one check kind. */
export type CheckSpecInput<
  Tag extends CheckSpecEncoded["_tag"] = CheckSpecEncoded["_tag"],
> = Extract<CheckSpecEncoded, { readonly _tag: Tag }>;

export type RatchetMeasure = typeof Measure.Encoded;

const { LintToZero, Migrate, Ratchet, RedThenGreen } = CheckSpec.cases;

const { Count, Metric } = Measure.cases;

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

export const check = {
  /** A lint rule's count goes to zero: red while `command` (the project's lint, as JSON) reports `rule` on main. */
  lintToZero: (rule: string, command: string): CheckSpecInput<"LintToZero"> =>
    Schema.encodeSync(LintToZero)(
      LintToZero.make(Schema.decodeSync(lintToZeroFields)({ command, rule }))
    ),
  /** Every use of `from` moves to `to`; `count` prints `{"total": n, "byModule": {...}}`. */
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
    /** Counts findings in the project's own lint JSON output (oxlint or ESLint), for one rule or all. */
    count: (
      command: string,
      options?: { readonly rule?: string }
    ): RatchetMeasure =>
      Schema.encodeSync(Count)(
        Count.make(Schema.decodeSync(countFields)({ command, ...options }))
      ),
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
  /** One check file fails on main by an assertion and passes on the answer; `test` runs it with `path` for `{path}`. */
  redThenGreen: (path: string): CheckSpecInput<"RedThenGreen"> =>
    Schema.encodeSync(RedThenGreen)(
      RedThenGreen.make(Schema.decodeSync(redThenGreenFields)({ path }))
    ),
};
