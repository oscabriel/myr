/**
 * The debt count's pure core: read the escapes `fence/debt-ledger` reports,
 * count them by kind, and name each kind whose count rose above the baseline.
 * `scripts/debt.ts` runs oxlint and feeds this; tests import it directly.
 */
import { Effect, Schema } from "effect";

/** Each kind of escape, counted apart. These are `debt.baseline.json`'s keys. */
export const Kind = Schema.Literals([
  "oxlint-disable",
  "@effect-diagnostics",
  "@ts-expect-error",
  "@ts-ignore",
  "@ts-nocheck",
]);

export type Kind = typeof Kind.Type;

/** One escape: where it is, what it says, and its reason after ` -- `. */
export const LedgerEntry = Schema.Struct({
  directive: Schema.String,
  kind: Kind,
  line: Schema.Int,
  path: Schema.String,
  reason: Schema.optionalKey(Schema.String),
});

export type LedgerEntry = typeof LedgerEntry.Type;

/** A count per kind, as `debt.baseline.json` holds it. */
export const Tally = Schema.Struct({
  "@effect-diagnostics": Schema.Int,
  "@ts-expect-error": Schema.Int,
  "@ts-ignore": Schema.Int,
  "@ts-nocheck": Schema.Int,
  "oxlint-disable": Schema.Int,
});

export type Tally = typeof Tally.Type;

/** A kind whose count is above its baseline. */
export interface Rise {
  readonly kind: Kind;
  readonly count: number;
  readonly baseline: number;
}

/**
 * oxlint's arguments, run from the repo root, for a JSON report of every
 * escape and nothing else: `-A all` keeps the default categories out.
 */
export const ledgerArgs: readonly string[] = [
  "-c",
  "oxlint.debt.config.ts",
  "-A",
  "all",
  "-D",
  "fence/debt-ledger",
  "--format",
  "json",
];

// The rule's message is itself JSON: `{directive, kind, reason?}`.
const Directive = Schema.Struct({
  directive: Schema.String,
  kind: Kind,
  reason: Schema.optionalKey(Schema.String),
});

const OxlintReport = Schema.Struct({
  diagnostics: Schema.Array(
    Schema.Struct({
      filename: Schema.String,
      labels: Schema.NonEmptyArray(
        Schema.Struct({ span: Schema.Struct({ line: Schema.Int }) })
      ),
      message: Schema.fromJsonString(Directive),
    })
  ),
});

const byPlace = (a: LedgerEntry, b: LedgerEntry) =>
  a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path);

/**
 * Decodes oxlint's `--format json` report into the ledger, sorted by path and
 * line, since oxlint reports files in whatever order its threads finish.
 */
export const ledgerFromOxlintJson = (
  json: string
): Effect.Effect<readonly LedgerEntry[], Schema.SchemaError> =>
  Schema.decodeEffect(Schema.fromJsonString(OxlintReport))(json).pipe(
    Effect.map(({ diagnostics }) =>
      diagnostics
        .map(({ filename, labels, message }) => {
          const entry = {
            directive: message.directive,
            kind: message.kind,
            line: labels[0].span.line,
            path: filename,
          };

          return message.reason === undefined
            ? entry
            : { ...entry, reason: message.reason };
        })
        .toSorted(byPlace)
    )
  );

/** How many escapes of each kind the ledger holds. */
export const tally = (entries: readonly LedgerEntry[]): Tally => {
  const count = (kind: Kind) =>
    entries.filter((entry) => entry.kind === kind).length;

  return {
    "@effect-diagnostics": count("@effect-diagnostics"),
    "@ts-expect-error": count("@ts-expect-error"),
    "@ts-ignore": count("@ts-ignore"),
    "@ts-nocheck": count("@ts-nocheck"),
    "oxlint-disable": count("oxlint-disable"),
  };
};

/** Each kind whose count is above the baseline, in `Kind`'s order. */
export const rises = (counted: Tally, baseline: Tally): readonly Rise[] =>
  Kind.literals.flatMap((kind) =>
    counted[kind] > baseline[kind]
      ? [{ baseline: baseline[kind], count: counted[kind], kind }]
      : []
  );
