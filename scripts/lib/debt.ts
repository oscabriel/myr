/**
 * The debt ratchet's pure core: read the escapes `fence/debt-ledger` reports,
 * count them by kind, judge the count against the baseline (a rise or an
 * escape without a reason fails), and lower the baseline, never raise it.
 * `scripts/debt.ts` runs oxlint and feeds this; tests import it directly.
 */
import { Array as Arr, Data, Effect, Order, Schema } from "effect";

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

/** How many escapes of each kind `debt.baseline.json` allows. */
export const Baseline = Schema.Record(Kind, Schema.Int);

export type Baseline = typeof Baseline.Type;

/** A count per kind, the baseline's shape: what the ledger holds now. */
export const Tally = Baseline;

export type Tally = Baseline;

/** One kind whose count is not its baseline. */
export interface Change {
  readonly kind: Kind;
  readonly count: number;
  readonly baseline: number;
}

/** A change upward: the count is above the baseline. */
export type Rise = Change;

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

/** A count for every kind; the type checker holds that none is missed. */
const perKind = (count: (kind: Kind) => number): Tally => ({
  "@effect-diagnostics": count("@effect-diagnostics"),
  "@ts-expect-error": count("@ts-expect-error"),
  "@ts-ignore": count("@ts-ignore"),
  "@ts-nocheck": count("@ts-nocheck"),
  "oxlint-disable": count("oxlint-disable"),
});

/** How many escapes of each kind the ledger holds. */
export const tally = (entries: readonly LedgerEntry[]): Tally =>
  perKind((kind) => entries.filter((entry) => entry.kind === kind).length);

/** Each kind whose count is not its baseline, in `Kind`'s order. */
const changes = (counted: Tally, baseline: Baseline): readonly Change[] =>
  Kind.literals.flatMap((kind) =>
    counted[kind] === baseline[kind]
      ? []
      : [{ baseline: baseline[kind], count: counted[kind], kind }]
  );

/** Each kind whose count is above the baseline, in `Kind`'s order. */
export const rises = (counted: Tally, baseline: Baseline): readonly Change[] =>
  changes(counted, baseline).filter((change) => change.count > change.baseline);

/** Each kind whose count is below the baseline, in `Kind`'s order. */
export const falls = (counted: Tally, baseline: Baseline): readonly Change[] =>
  changes(counted, baseline).filter((change) => change.count < change.baseline);

/**
 * Each escape with nothing after ` -- ` on its own line. A comment above the
 * directive, such as a `SAFETY:` line, is not its reason.
 */
export const unreasoned = (
  entries: readonly LedgerEntry[]
): readonly LedgerEntry[] =>
  entries.filter((entry) => (entry.reason ?? "").trim() === "");

/** What the count says against the baseline. */
export type Verdict = Data.TaggedEnum<{
  /** Passes. A kind that fell below its baseline can be lowered. */
  Held: { readonly tally: Tally; readonly falls: readonly Change[] };
  /** Fails: a kind rose above its baseline, or an escape has no reason. */
  Rose: {
    readonly rises: readonly Change[];
    readonly unreasoned: readonly LedgerEntry[];
  };
}>;

export const Verdict = Data.taggedEnum<Verdict>();

/**
 * Judges the ledger against the baseline. It holds only when no kind rose and
 * every escape has a reason, wherever it is: a count at its baseline does not
 * excuse an escape without one.
 */
export const judge = (
  entries: readonly LedgerEntry[],
  baseline: Baseline
): Verdict => {
  const counted = tally(entries);
  const risen = rises(counted, baseline);
  const without = unreasoned(entries);

  return risen.length + without.length === 0
    ? Verdict.Held({ falls: falls(counted, baseline), tally: counted })
    : Verdict.Rose({ rises: risen, unreasoned: without });
};

/**
 * The baseline after `--lower`: each kind at the lower of its count and its
 * baseline, so no number ever goes up. Raising one takes the user's sign-off.
 */
export const lowered = (counted: Tally, baseline: Baseline): Baseline =>
  perKind((kind) => Math.min(counted[kind], baseline[kind]));

/**
 * The baseline as `debt.baseline.json` holds it, byte for byte what oxfmt
 * keeps: keys sorted, two-space indent, a trailing newline. Decoding orders
 * the keys by `Kind`, so they are sorted here.
 */
export const renderBaseline = (baseline: Baseline): string => {
  const sorted = Object.fromEntries(
    Arr.sort(Kind.literals, Order.String).map((kind) => [kind, baseline[kind]])
  );

  return `${JSON.stringify(sorted, null, 2)}\n`;
};

/** The per-kind table: each kind's count over its baseline, aligned. */
export const renderTable = (counted: Tally, baseline: Baseline): string => {
  const width = Math.max(...Kind.literals.map((kind) => kind.length));

  return [
    "debt: escapes by kind, count/baseline",
    ...Kind.literals.map(
      (kind) => `  ${kind.padStart(width)} ${counted[kind]}/${baseline[kind]}`
    ),
  ].join("\n");
};

const escapes = (count: number) =>
  count === 1 ? "1 escape" : `${count} escapes`;

const changed = (change: Change, verb: string, side: string) =>
  `debt: ${change.kind} ${verb} to ${escapes(change.count)}, ${side} its baseline of ${change.baseline}.`;

/** What the verdict tells the reader, and what to do next. */
export const renderVerdict = (verdict: Verdict): string =>
  Verdict.$match(verdict, {
    Held: ({ falls: fell }) =>
      fell.length === 0
        ? "debt: every kind is at its baseline, and every escape has a reason."
        : [
            ...fell.map((fall) => changed(fall, "fell", "below")),
            "debt: lower the baseline to match: bun run debt -- --lower",
          ].join("\n"),
    Rose: ({ rises: risen, unreasoned: without }) =>
      [
        ...risen.map((rise) => changed(rise, "rose", "above")),
        ...without.map(
          (entry) =>
            `debt: ${entry.path}:${entry.line} ${entry.directive} has no reason after " -- ".`
        ),
        "debt: remove the new escape or fix what it hides, and give every escape its reason after \" -- \" on the directive's own line. Raising debt.baseline.json needs the user's sign-off (AGENTS.md principle 10).",
      ].join("\n"),
  });

/** What `--lower` did: each kind's baseline, before and after. */
export const renderLowered = (fell: readonly Change[]): string =>
  fell
    .map(
      (fall) =>
        `debt: lowered the ${fall.kind} baseline from ${fall.baseline} to ${escapes(fall.count)}.`
    )
    .join("\n");
