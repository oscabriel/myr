/**
 * What a ledger says about its sealed areas, folded from its entries, and
 * the one sentence its page opens on: the posture label, then each area's
 * count and authors ("Open with sealed evidence. export: 7 sealed checks
 * by 3 people."). A module with no view of its own.
 */
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import type { Ledger } from "@repo/protocol/domain/visibility";
import type { AreaName, SuiteRoot } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import { Option } from "effect";

/** An admission's evidence: when, how many green runs on main, how many known-bad trees it failed. */
export interface Admission {
  readonly at: DateTime.Utc;
  readonly knownBadCaught: number;
  readonly mainRuns: number;
}

/** One sealed area, as its entries leave it. */
export interface AreaSummary {
  /** The admission of the area's current root; none when that root joined without one. */
  readonly admission: Option.Option<Admission>;
  readonly area: AreaName;
  /** How many people wrote the suite, as its latest commitment counts them. */
  readonly authors: Option.Option<number>;
  /** When any entry about the area was last recorded. */
  readonly changedAt: DateTime.Utc;
  /** How many sealed checks the area holds, as its latest count or commitment says. */
  readonly checks: number;
  /** The suite's salted root, as its latest commitment or admission names it. */
  readonly root: Option.Option<SuiteRoot>;
}

/** What one entry says about an area, if it is about one. */
interface AreaFact {
  readonly admitted: Option.Option<Admission & { readonly suite: SuiteRoot }>;
  readonly area: AreaName;
  readonly at: DateTime.Utc;
  readonly authors: Option.Option<number>;
  readonly checks: Option.Option<number>;
  readonly root: Option.Option<SuiteRoot>;
}

/** A fact that says nothing yet: each kind of entry fills in what it knows. */
const noFact: Omit<AreaFact, "area" | "at"> = {
  admitted: Option.none(),
  authors: Option.none(),
  checks: Option.none(),
  root: Option.none(),
};

const factsOf = (entry: LedgerEntry): readonly AreaFact[] =>
  LedgerEntry.match(entry, {
    Admitted: ({ area, at, knownBadCaught, mainRuns, suite }) => [
      {
        ...noFact,
        admitted: Option.some({ at, knownBadCaught, mainRuns, suite }),
        area,
        at,
        root: Option.some(suite),
      },
    ],
    CommitmentPublished: ({ area, at, authors, checks, suite }) => [
      {
        ...noFact,
        area,
        at,
        authors: Option.some(authors),
        checks: Option.some(checks),
        root: Option.some(suite),
      },
    ],
    CountChanged: ({ area, at, count }) => [
      { ...noFact, area, at, checks: Option.some(count) },
    ],
    LayerDeclared: () => [],
    PostureChanged: () => [],
    Released: () => [],
    ValueSet: () => [],
  });

/** The ledger's entries in the order they were recorded. */
const recorded = (ledger: Ledger) =>
  ledger.entries.toSorted((one, other) => one.seq - other.seq);

/** An area as its facts so far leave it: each later fact overrides what it says. */
interface Folded {
  readonly admissions: ReadonlyMap<SuiteRoot, Admission>;
  readonly area: AreaName;
  readonly authors: Option.Option<number>;
  readonly changedAt: DateTime.Utc;
  readonly checks: Option.Option<number>;
  readonly root: Option.Option<SuiteRoot>;
}

const foldFact = (before: Folded | undefined, fact: AreaFact): Folded => ({
  admissions: Option.match(fact.admitted, {
    onNone: () => before?.admissions ?? new Map(),
    onSome: ({ suite, ...admission }) =>
      new Map([...(before?.admissions ?? []), [suite, admission]]),
  }),
  area: fact.area,
  authors: Option.orElse(fact.authors, () => before?.authors ?? Option.none()),
  changedAt: fact.at,
  checks: Option.orElse(fact.checks, () => before?.checks ?? Option.none()),
  root: Option.orElse(fact.root, () => before?.root ?? Option.none()),
});

/**
 * Each sealed area's latest count, authors and root, when it last changed,
 * and the admission of its current root, folded from the entries in the
 * order they were recorded; areas by name.
 */
export const areaSummaries = (ledger: Ledger): readonly AreaSummary[] => {
  const areas = new Map<AreaName, Folded>();

  for (const fact of recorded(ledger).flatMap(factsOf)) {
    areas.set(fact.area, foldFact(areas.get(fact.area), fact));
  }

  return [...areas.values()]
    .toSorted((one, other) => one.area.localeCompare(other.area))
    .map(({ admissions, area, authors, changedAt, checks, root }) => ({
      admission: Option.flatMap(root, (suite) =>
        Option.fromUndefinedOr(admissions.get(suite))
      ),
      area,
      authors,
      changedAt,
      checks: Option.getOrElse(checks, () => 0),
      root,
    }));
};

export const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** "export: 7 sealed checks by 3 people". */
export const areaHeadline = ({ area, authors, checks }: AreaSummary) =>
  `${area}: ${plural(checks, "sealed check", "sealed checks")}${Option.match(
    authors,
    {
      onNone: () => "",
      onSome: (count) => ` by ${plural(count, "person", "people")}`,
    }
  )}`;

/** The ledger's head sentence: what leads it, and the rest. */
export interface LedgerHead {
  readonly lead: string;
  readonly rest: string;
}

/**
 * The ledger in one sentence, in two parts: its lead, the posture label,
 * and the rest, every sealed area's headline, or what it holds back when
 * no area is counted yet. A label that names the sealed areas ("Open with
 * sealed evidence · sealed checks in export, parser") leads with its
 * posture alone when the areas follow with their counts, so no area is
 * named twice; any other label leads whole.
 */
export const ledgerHead = (ledger: Ledger): LedgerHead => {
  const areas = areaSummaries(ledger);

  if (areas.length > 0) {
    const [posture = ledger.postureLabel] =
      ledger.posture === "openWithSealedEvidence"
        ? ledger.postureLabel.split(" · ")
        : [ledger.postureLabel];

    return {
      lead: posture,
      rest: `. ${areas.map(areaHeadline).join("; ")}.`,
    };
  }

  return {
    lead: ledger.postureLabel,
    rest:
      ledger.layers.length === 0
        ? ". Nothing is held back."
        : `. ${plural(ledger.layers.length, "layer", "layers")} declared; no sealed checks counted yet.`,
  };
};
