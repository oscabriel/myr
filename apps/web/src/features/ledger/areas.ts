import { LedgerEntry } from "@repo/protocol/domain/visibility";
import type { Ledger } from "@repo/protocol/domain/visibility";
import type { AreaName, SuiteRoot } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import { Option } from "effect";

export interface Admission {
  readonly at: DateTime.Utc;
  readonly knownBadCaught: number;
  readonly mainRuns: number;
}

export interface AreaSummary {
  readonly admission: Option.Option<Admission>;
  readonly area: AreaName;
  readonly authors: Option.Option<number>;
  readonly changedAt: DateTime.Utc;
  readonly checks: number;
  readonly root: Option.Option<SuiteRoot>;
}

interface AreaFact {
  readonly admitted: Option.Option<Admission & { readonly suite: SuiteRoot }>;
  readonly area: AreaName;
  readonly at: DateTime.Utc;
  readonly authors: Option.Option<number>;
  readonly checks: Option.Option<number>;
  readonly root: Option.Option<SuiteRoot>;
}

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

const recorded = (ledger: Ledger) =>
  ledger.entries.toSorted((one, other) => one.seq - other.seq);

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

export const areaHeadline = ({ area, authors, checks }: AreaSummary) =>
  `${area}: ${plural(checks, "sealed check", "sealed checks")}${Option.match(
    authors,
    {
      onNone: () => "",
      onSome: (count) => ` by ${plural(count, "person", "people")}`,
    }
  )}`;

export interface LedgerHead {
  readonly lead: string;
  readonly rest: string;
}

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
