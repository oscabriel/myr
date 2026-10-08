/**
 * A project's ledger, in its own terms (OSR §6.1): the posture label the
 * platform computed, each declared layer with its audience, kinds,
 * disclosure and reason, each sealed area folded from the entries (how many
 * sealed checks, how many people wrote them, the suite's salted root, when
 * it last changed, its admission record), then every entry, newest first.
 *
 * Props in, markup out: the route reads the ledger (`src/client/ledger.ts`)
 * and hands it here. The ledger carries no path, no check name and no file
 * name, and nothing here adds one; the layer read log is maintainers' data
 * and never reaches the public ledger.
 */
import { Brand } from "@repo/brand";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import type {
  Disclosure,
  Layer,
  Ledger,
} from "@repo/protocol/domain/visibility";
import type { AreaName, SuiteRoot } from "@repo/protocol/ids";
import { DateTime, Option } from "effect";
import type { ReactNode } from "react";

import { CODE, Field, Fields, LINK, Region } from "../ask/fields.tsx";
import { postureLabel } from "../project/posture-label.ts";
import { CommandLine } from "../shared/command.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { PageShell } from "../shared/layout.tsx";
import { PostureBadge } from "../shared/posture.tsx";
import { When } from "../shared/time.tsx";

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

/** What people outside a layer's audience learn about what it holds (OSR §2.2). */
const disclosures = {
  counted: "counted: how many it holds, and when they open",
  declared: "declared: that it exists, with its kinds and reason",
  hidden: "hidden: nothing beyond its name",
  public: "public: everything",
  sealed:
    "sealed: counts, authors and a salted root; never names, paths or contents",
  writeOnly:
    "write-only: names, and who set each value and when; never a value",
} as const satisfies Record<Disclosure, string>;

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** A day as a reader skims it: "Oct 11", in UTC. */
const dayOf = (at: DateTime.Utc) =>
  DateTime.formatUtc(at, { day: "numeric", locale: "en-US", month: "short" });

/** A commit as git abbreviates it. */
const short = (sha: string) => sha.slice(0, 7);

/**
 * When the ledger was read, at the latest: `now`, or its newest entry's
 * time if that is later. The page keeps the `now` it was served with while
 * it reads the ledger again as entries arrive, and a recorded entry is never
 * in the future.
 */
const readAt = (ledger: Ledger, now: DateTime.Utc) => {
  let latest = now;

  for (const entry of ledger.entries) {
    latest = DateTime.max(latest, entry.at);
  }

  return latest;
};

const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className={CODE}>{children}</code>
);

const LayerBlock = ({ layer }: { readonly layer: Layer }) => (
  <li className="flex min-w-0 flex-col gap-2" data-layer={layer.name}>
    <h3 className={`${CODE} text-sealed font-medium`}>{layer.name}</h3>
    <Fields label={`Layer ${layer.name}`}>
      <Field label="Audience">{layer.audience}</Field>
      <Field label="Holds">{layer.holds.join(", ")}</Field>
      <Field label="Disclosure">{disclosures[layer.disclose]}</Field>
      <Field label="Reason">{layer.reason}</Field>
      {layer.sunsetDays === undefined ? null : (
        <Field label="Sunset">{`after ${plural(layer.sunsetDays, "day", "days")}`}</Field>
      )}
      {layer.maxDays === undefined ? null : (
        <Field label="Longest unreleased">
          {plural(layer.maxDays, "day", "days")}
        </Field>
      )}
    </Fields>
  </li>
);

/** "admitted Oct 11; passes main 3/3; catches 2 known-bad", or why there is none. */
const admissionWords = (summary: AreaSummary) =>
  Option.match(summary.admission, {
    onNone: () => "joined without admission runs",
    onSome: ({ at, knownBadCaught, mainRuns }) =>
      `admitted ${dayOf(at)}; passes main ${mainRuns}/${mainRuns}; catches ${knownBadCaught} known-bad`,
  });

/** "export: 7 sealed checks by 3 people". */
const areaHeadline = ({ area, authors, checks }: AreaSummary) =>
  `${area}: ${plural(checks, "sealed check", "sealed checks")}${Option.match(
    authors,
    {
      onNone: () => "",
      onSome: (count) => ` by ${plural(count, "person", "people")}`,
    }
  )}`;

const AreaBlock = ({
  now,
  summary,
}: {
  readonly now: DateTime.Utc;
  readonly summary: AreaSummary;
}) => (
  <li className="flex min-w-0 flex-col gap-2" data-area={summary.area}>
    <h3 className="text-sealed font-medium">{areaHeadline(summary)}</h3>
    <Fields label={`Sealed checks in ${summary.area}`}>
      <Field label="Root">
        {Option.isSome(summary.root) ? (
          <Code>{summary.root.value}</Code>
        ) : (
          "none published yet"
        )}
      </Field>
      <Field label="Last changed">
        <When at={summary.changedAt} now={now} />
      </Field>
      <Field label="Admission">{admissionWords(summary)}</Field>
    </Fields>
  </li>
);

/** One entry in words, as the ledger records it. */
const EntryWords = ({ entry }: { readonly entry: LedgerEntry }) =>
  LedgerEntry.match(entry, {
    Admitted: ({ area, knownBadCaught, mainRuns, suite }) => (
      <>
        {`${area} admitted: passes main ${mainRuns}/${mainRuns}; catches ${knownBadCaught} known-bad; root `}
        <Code>{suite}</Code>
      </>
    ),
    CommitmentPublished: ({ area, authors, checks, suite }) => (
      <>
        {`Commitment for ${area}: ${plural(checks, "sealed check", "sealed checks")} by ${plural(authors, "person", "people")}; root `}
        <Code>{suite}</Code>
      </>
    ),
    CountChanged: ({ area, count, layer }) => (
      <>
        <Code>{layer}</Code>
        {` holds ${count} in ${area}`}
      </>
    ),
    LayerDeclared: ({ disclose, kinds, layer }) => (
      <>
        {"Layer "}
        <Code>{layer}</Code>
        {` declared, holding ${kinds.join(", ")}; ${disclose}`}
      </>
    ),
    PostureChanged: ({ decision, from, to }) => (
      <>
        {`Posture changed from ${postureLabel(from)} to ${postureLabel(to)}, by decision `}
        <Code>{decision}</Code>
      </>
    ),
    Released: ({ by, landing, layer, paths }) => (
      <>
        <HandleLink handle={by} />
        {` released ${plural(paths, "path", "paths")} from `}
        <Code>{layer}</Code>
        {" in "}
        <Code>{short(landing)}</Code>
      </>
    ),
    ValueSet: ({ by, key }) => (
      <>
        <HandleLink handle={by} />
        {" set the value of "}
        <Code>{key}</Code>, which nobody can read back
      </>
    ),
  });

const History = ({
  ledger,
  now,
}: {
  readonly ledger: Ledger;
  readonly now: DateTime.Utc;
}) =>
  ledger.entries.length === 0 ? (
    <EmptyState title="Nothing recorded yet. An entry is added when a layer is declared, a count or commitment changes, a suite is admitted, a layer is released, the posture changes or a value is set." />
  ) : (
    <ol className="border-rule flex flex-col border-b">
      {recorded(ledger)
        .toReversed()
        .map((entry) => (
          <li
            className="border-rule grid gap-x-6 gap-y-1 border-t py-3 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]"
            data-entry={entry._tag}
            data-seq={entry.seq}
            key={entry.seq}
          >
            <span className="text-muted-foreground text-xs font-medium sm:pt-0.5">
              <When at={entry.at} now={now} />
            </span>
            <p className="min-w-0 [overflow-wrap:anywhere]">
              <EntryWords entry={entry} />
            </p>
          </li>
        ))}
    </ol>
  );

export const LedgerView = ({
  ledger,
  now,
}: {
  readonly ledger: Ledger;
  readonly now: DateTime.Utc;
}) => {
  const { layers, project } = ledger;
  const areas = areaSummaries(ledger);
  const seen = readAt(ledger, now);

  return (
    <PageShell title={`Ledger of ${project}`}>
      <div className="text-muted-foreground -mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <PostureBadge label={ledger.postureLabel} posture={ledger.posture} />
        <span>{plural(layers.length, "layer", "layers")}</span>
        <a className={LINK} href={`/${project}`}>
          {`${project}'s asks and landings`}
        </a>
      </div>
      <p className="max-w-[70ch]">
        The public, append-only record of {project}&apos;s layers, counts,
        commitments, releases and posture changes. The same record is the{" "}
        <Code>ledger</Code> tool over MCP and a command in the CLI:
      </p>
      <CommandLine command={`${Brand.cli} ledger --project ${project}`} />
      <Region id="layers" title="Layers">
        {layers.length === 0 ? (
          <EmptyState
            title={`Nothing is held back: ${project} declares no layers, so every file it ships and every check that judges an answer is in its public repo.`}
          />
        ) : (
          <ul className="flex flex-col gap-6">
            {layers.map((layer) => (
              <LayerBlock key={layer.name} layer={layer} />
            ))}
          </ul>
        )}
      </Region>
      {areas.length === 0 ? null : (
        <Region id="sealed-checks" title="Sealed checks">
          <p className="max-w-[70ch] text-sm">
            Held-back checks judge every answer in their area. Their names,
            paths and contents stay in the layer; the public sees how many there
            are, how many people wrote them, and the salted root each judged
            landing prints in its <Code>Held-back:</Code> trailer.
          </p>
          <ul className="flex flex-col gap-6">
            {areas.map((summary) => (
              <AreaBlock key={summary.area} now={seen} summary={summary} />
            ))}
          </ul>
        </Region>
      )}
      <Region id="history" title="History">
        <History ledger={ledger} now={seen} />
      </Region>
    </PageShell>
  );
};
