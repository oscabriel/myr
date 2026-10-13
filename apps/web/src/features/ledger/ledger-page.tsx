/**
 * The Visibility tab's posture, layers, held-back checks and ledger. The
 * ledger carries no path, no check name and no file name, and nothing here
 * adds one; the layer read log is maintainers' data and never reaches the
 * public ledger. A layer's files are never browsed here (principle 7).
 */
import { Brand } from "@repo/brand";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import type { Layer, Ledger, Members } from "@repo/protocol/domain/visibility";
import type { Handle, ProjectName } from "@repo/protocol/ids";
import { DateTime, Match, Option } from "effect";
import { LockKeyhole } from "lucide-react";
import { Fragment } from "react";
import type { ReactNode } from "react";

import { Definition, Definitions, Region } from "../ask/fields.tsx";
import { commitHref, shortSha } from "../code/paths.ts";
import { postureLabel } from "../project/posture-label.ts";
import { CommandLine } from "../shared/command.tsx";
import { CopyAction } from "../shared/copy-action.tsx";
import { disclosureWords } from "../shared/disclosure.ts";
import { EmptyState } from "../shared/empty.tsx";
import {
  CodeValue,
  FactBlock,
  HeldBackFacts,
  PostureFacts,
} from "../shared/facts.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { POSTURE_MARKS } from "../shared/mark-look.ts";
import { Mark } from "../shared/marks.tsx";
import { When } from "../shared/time.tsx";
import { areaHeadline, ledgerHead, plural } from "./areas.ts";
import type { AreaSummary } from "./areas.ts";

const dayOf = (at: DateTime.Utc) =>
  DateTime.formatUtc(at, { day: "numeric", locale: "en-US", month: "short" });

/** The page's clock, never behind an entry that arrived after it was read. */
export const ledgerReadAt = (ledger: Ledger, now: DateTime.Utc) => {
  let latest = now;

  for (const entry of ledger.entries) {
    latest = DateTime.max(latest, entry.at);
  }

  return latest;
};

const newestFirst = (ledger: Ledger) =>
  ledger.entries.toSorted((one, other) => other.seq - one.seq);

const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className="text-mono font-mono [overflow-wrap:anywhere]">
    {children}
  </code>
);

const postureTone = {
  open: "text-foreground",
  openCore: "text-sealed",
  openOnSchedule: "text-sealed",
  openWithSealedEvidence: "text-sealed",
  sourceAvailable: "text-foreground",
} as const satisfies Record<Ledger["posture"], string>;

export const HeadSentence = ({ ledger }: { readonly ledger: Ledger }) => {
  const { lead, rest } = ledgerHead(ledger);

  return (
    <p className="text-want max-w-[70ch] text-pretty" data-ledger-head="">
      <Mark
        className="mr-2 inline-block -translate-y-px align-middle"
        look={POSTURE_MARKS[ledger.posture]}
      />
      <span
        className={`font-semibold ${postureTone[ledger.posture]}`}
        data-posture={ledger.posture}
      >
        {lead}
      </span>
      {rest}
    </p>
  );
};

const Handles = ({ handles }: { readonly handles: readonly Handle[] }) =>
  handles.map((handle, index) => (
    <Fragment key={handle}>
      {index === 0 ? null : ", "}
      <HandleLink handle={handle} />
    </Fragment>
  ));

const MembersOf = ({ members }: { readonly members: Members }) =>
  members === "deciders" ? "the maintainers" : <Handles handles={members} />;

const LayerBlock = ({ layer }: { readonly layer: Layer }) => (
  <li className="flex min-w-0 flex-col gap-2" data-layer={layer.name}>
    <h3
      className="text-mono text-sealed flex items-center gap-2 font-mono font-medium"
      data-layer-name=""
    >
      <LockKeyhole
        aria-hidden="true"
        className="size-4 shrink-0"
        strokeWidth={1.75}
      />
      {layer.name}
    </h3>
    <Definitions label={`Layer ${layer.name}`}>
      <Definition term="Audience">{layer.audience}</Definition>
      <Definition term="Holds">{layer.holds.join(", ")}</Definition>
      <Definition term="Disclosure">
        {disclosureWords[layer.disclose]}
      </Definition>
      <Definition term="Reason">{layer.reason}</Definition>
      <Definition term="Readers">
        <MembersOf members={layer.readers} />
      </Definition>
      <Definition term="Writers">
        <MembersOf members={layer.writers} />
      </Definition>
      {layer.sunsetDays === undefined ? null : (
        <Definition term="Sunset">
          <span className="tabular-nums">{`released after ${plural(layer.sunsetDays, "day", "days")}`}</span>
        </Definition>
      )}
      {layer.maxDays === undefined ? null : (
        <Definition term="Longest unreleased">
          <span className="tabular-nums">
            {plural(layer.maxDays, "day", "days")}
          </span>
        </Definition>
      )}
    </Definitions>
  </li>
);

const admissionWords = (summary: AreaSummary) =>
  Option.match(summary.admission, {
    onNone: () => "joined without admission runs",
    onSome: ({ at, knownBadCaught, mainRuns }) =>
      `admitted ${dayOf(at)}; passes main ${mainRuns}/${mainRuns}; catches ${knownBadCaught} known-bad`,
  });

const AreaBlock = ({
  now,
  summary,
}: {
  readonly now: DateTime.Utc;
  readonly summary: AreaSummary;
}) => (
  <li className="flex min-w-0 flex-col gap-2" data-area={summary.area}>
    <h3
      className="text-title text-sealed flex items-center gap-2"
      data-area-title=""
    >
      <LockKeyhole
        aria-hidden="true"
        className="size-4 shrink-0"
        strokeWidth={1.75}
      />
      {areaHeadline(summary)}
    </h3>
    <Definitions label={`Sealed checks in ${summary.area}`}>
      <Definition term="Root">
        {Option.isSome(summary.root) ? (
          <span className="flex min-w-0 items-center gap-2">
            <CodeValue value={summary.root.value} />
            <CopyAction
              command={summary.root.value}
              label={`Copy ${summary.area}'s root`}
            />
          </span>
        ) : (
          "none published yet"
        )}
      </Definition>
      <Definition term="Admission">{admissionWords(summary)}</Definition>
      <Definition term="Last changed">
        <When at={summary.changedAt} now={now} />
      </Definition>
    </Definitions>
  </li>
);

const kindOf = Match.type<LedgerEntry>().pipe(
  Match.tagsExhaustive({
    Admitted: () => ({ sealed: true, word: "Admitted" }),
    CommitmentPublished: () => ({ sealed: true, word: "Commitment changed" }),
    CountChanged: () => ({ sealed: true, word: "Count changed" }),
    LayerDeclared: () => ({ sealed: false, word: "Layer added" }),
    PostureChanged: () => ({ sealed: false, word: "Posture changed" }),
    Released: () => ({ sealed: false, word: "Released" }),
    ValueSet: () => ({ sealed: true, word: "Value set" }),
  })
);

const EntryWords = ({
  entry,
  project,
}: {
  readonly entry: LedgerEntry;
  readonly project: ProjectName;
}): ReactNode =>
  Match.value(entry).pipe(
    Match.tagsExhaustive({
      Admitted: ({ area, knownBadCaught, mainRuns }) =>
        `${area} admitted: passes main ${mainRuns}/${mainRuns}; catches ${knownBadCaught} known-bad`,
      CommitmentPublished: ({ area, authors, checks }) =>
        `${area}: ${plural(checks, "sealed check", "sealed checks")} by ${plural(authors, "person", "people")}`,
      CountChanged: ({ area, count, layer }) => (
        <>
          <Code>{layer}</Code>
          {` holds ${count} in ${area}`}
        </>
      ),
      LayerDeclared: ({ disclose, kinds, layer }) => (
        <>
          <Code>{layer}</Code>
          {` declared, holding ${kinds.join(", ")}; ${disclose}`}
        </>
      ),
      PostureChanged: ({ decision, from, to }) => (
        <>
          {`${postureLabel(from)} to ${postureLabel(to)}, by decision `}
          <Code>{decision}</Code>
        </>
      ),
      Released: ({ by, landing, layer, paths }) => (
        <>
          <HandleLink handle={by} />
          {` released ${plural(paths, "path", "paths")} from `}
          <Code>{layer}</Code>
          {" in "}
          <AppLink
            className="text-mono decoration-rule font-mono underline hover:decoration-current"
            title={landing}
            to={commitHref(project, landing)}
          >
            {shortSha(landing)}
          </AppLink>
        </>
      ),
      ValueSet: ({ by, key }) => (
        <>
          <HandleLink handle={by} />
          {" set "}
          <Code>{key}</Code>, which nobody can read back
        </>
      ),
    })
  );

const rootOf = (entry: LedgerEntry): Option.Option<string> =>
  LedgerEntry.match(entry, {
    Admitted: ({ suite }) => Option.some(suite),
    CommitmentPublished: ({ suite }) => Option.some(suite),
    CountChanged: () => Option.none(),
    LayerDeclared: () => Option.none(),
    PostureChanged: () => Option.none(),
    Released: () => Option.none(),
    ValueSet: () => Option.none(),
  });

const EntryRow = ({
  entry,
  now,
  project,
}: {
  readonly entry: LedgerEntry;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
}) => {
  const { sealed, word } = kindOf(entry);
  const root = rootOf(entry);

  return (
    <li
      className="border-rule text-ui tablet:flex-nowrap flex min-h-10 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b py-2"
      data-entry={entry._tag}
      data-seq={entry.seq}
    >
      <span className="text-label text-muted-foreground w-16 shrink-0 tabular-nums">
        <When at={entry.at} now={now} />
      </span>
      <span
        className={`tablet:w-40 shrink-0 font-medium ${sealed ? "text-sealed" : "text-foreground"}`}
        data-entry-word=""
      >
        {word}
      </span>
      <span className="tablet:basis-auto min-w-0 flex-1 basis-full [overflow-wrap:anywhere]">
        <EntryWords entry={entry} project={project} />
      </span>
      {Option.isNone(root) ? null : (
        <span className="text-muted-foreground shrink-0">
          <CodeValue value={root.value} />
        </span>
      )}
    </li>
  );
};

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
    <ol className="border-rule flex flex-col border-t">
      {newestFirst(ledger).map((entry) => (
        <EntryRow
          entry={entry}
          key={entry.seq}
          now={now}
          project={ledger.project}
        />
      ))}
    </ol>
  );

const Disclosures = () => (
  <FactBlock label="What each disclosure shows">
    <ul className="flex flex-col gap-1.5">
      {Object.values(disclosureWords).map((words) => (
        <li
          className="text-label text-muted-foreground font-normal"
          key={words}
        >
          {words}
        </li>
      ))}
    </ul>
  </FactBlock>
);

export const LedgerFacts = ({
  areas,
  ledger,
}: {
  readonly areas: readonly AreaSummary[];
  readonly ledger: Ledger;
}) => (
  <>
    <PostureFacts
      label={ledger.postureLabel}
      posture={ledger.posture}
      project={ledger.project}
    />
    <HeldBackFacts
      areas={areas.map((summary) => ({
        area: summary.area,
        detail: plural(summary.checks, "sealed check", "sealed checks"),
      }))}
    />
    <FactBlock label="Read it in a terminal">
      <CommandLine
        command={`${Brand.cli} ledger --project ${ledger.project}`}
        numbered
      />
    </FactBlock>
    <Disclosures />
  </>
);

export const LayersRegion = ({ ledger }: { readonly ledger: Ledger }) => (
  <Region id="layers" title="Layers">
    {ledger.layers.length === 0 ? (
      <EmptyState
        title={`Nothing is held back: ${ledger.project} declares no layers, so every file it ships and every check that judges an answer is in its public repo.`}
      />
    ) : (
      <>
        <p className="text-ui text-muted-foreground max-w-[70ch]">
          Everything on main is public. A layer&apos;s readers clone it with
          git, and none of its files is shown here.
        </p>
        <ul className="flex flex-col gap-6">
          {ledger.layers.map((layer) => (
            <LayerBlock key={layer.name} layer={layer} />
          ))}
        </ul>
      </>
    )}
  </Region>
);

export const HeldBackRegion = ({
  areas,
  now,
}: {
  readonly areas: readonly AreaSummary[];
  readonly now: DateTime.Utc;
}) => (
  <Region id="held-back" title="Held-back checks">
    {areas.length === 0 ? (
      <EmptyState title="No held-back checks: every check that judges an answer is in the public repo." />
    ) : (
      <>
        <p className="text-ui text-muted-foreground max-w-[70ch]">
          Held-back checks judge every answer in their area, unseen. A landing
          they judged names each area&apos;s root in its{" "}
          <Code>Held-back:</Code> trailer.
        </p>
        <ul className="flex flex-col gap-6">
          {areas.map((summary) => (
            <AreaBlock key={summary.area} now={now} summary={summary} />
          ))}
        </ul>
      </>
    )}
  </Region>
);

export const LedgerRegion = ({
  ledger,
  now,
}: {
  readonly ledger: Ledger;
  readonly now: DateTime.Utc;
}) => (
  <Region id="ledger" title="Ledger">
    <p className="text-ui text-muted-foreground max-w-[70ch]">
      {`Public and append-only · ${plural(ledger.entries.length, "entry", "entries")}`}
    </p>
    <History ledger={ledger} now={now} />
  </Region>
);
