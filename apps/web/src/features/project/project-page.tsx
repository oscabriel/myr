import { IMPORTED_NOTE } from "@repo/agent-kit/docs/imported-note";
import { Brand } from "@repo/brand";
import type { Ask, AskListing } from "@repo/protocol/domain/ask";
import type { FileView, TreeListing } from "@repo/protocol/domain/code";
import type { Glob } from "@repo/protocol/domain/common";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import type { LandingView } from "@repo/protocol/domain/landing";
import { StageName } from "@repo/protocol/domain/outcome";
import type { ImportSource } from "@repo/protocol/domain/policy";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import type { Ledger } from "@repo/protocol/domain/visibility";
import type { AreaName, AskId, Handle, ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { useRouter } from "@tanstack/react-router";
import { Option, Predicate } from "effect";
import type { DateTime } from "effect";
import type { ReactNode } from "react";

import {
  ForAgents,
  Onward,
  SelectedAskFacts,
  Step,
  plural,
} from "../front/facts.tsx";
import { finaleOf, stillWaiting } from "../front/families.ts";
import { ledeOf } from "../front/head.ts";
import { ProposeLink } from "../propose/propose-link.tsx";
import type { AskProgress } from "../shared/ask-progress.ts";
import { LINK } from "../shared/classes.ts";
import { CommandLine } from "../shared/command.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { FactBlock, GateFacts, HeldBackFacts } from "../shared/facts.tsx";
import { AppLink } from "../shared/link.tsx";
import { ledgerPath } from "../shared/paths.ts";
import { ReadingRows, UnreachableNotice } from "../shared/pending.tsx";
import { PostureBadge } from "../shared/posture.tsx";
import { MetaCode, MetaLine, useRowSelection } from "../shared/row.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { When } from "../shared/time.tsx";
import { AskList, askListIds, openAsks, openToTake } from "./asks.tsx";
import { LandingList, recentShown } from "./landings.tsx";
import { postureLabel, postureWord } from "./posture-label.ts";
import { ProjectNav } from "./project-nav.tsx";
import { ReadmeSection } from "./readme-section.tsx";

export interface ProjectCode {
  readonly readme?: FileView | undefined;
  readonly root: TreeListing;
}

export interface Deciders {
  readonly handles: readonly Handle[];
  readonly paths: Glob;
}

export interface HeldBackArea {
  readonly area: AreaName;
  readonly checks: number;
  readonly detail: string;
}

const noCount = (): readonly (readonly [AreaName, number])[] => [];

export const heldBackOf = (ledger: Ledger): readonly HeldBackArea[] => {
  const checks = new Map(
    ledger.entries
      .toSorted((a, b) => a.seq - b.seq)
      .flatMap((entry) =>
        LedgerEntry.match(entry, {
          Admitted: noCount,
          CommitmentPublished: ({ area, checks: count }) => [
            [area, count] as const,
          ],
          CountChanged: ({ area, count }) => [[area, count] as const],
          LayerDeclared: noCount,
          PostureChanged: noCount,
          Released: noCount,
          ValueSet: noCount,
        })
      )
  );

  return [...checks]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([area, count]) => ({
      area,
      checks: count,
      detail: `${count} sealed ${count === 1 ? "check" : "checks"}`,
    }));
};

/**
 * Until its own ledger has said it, the page says no posture, never one it was
 * not told.
 */
export type HomeListing = Omit<ProjectListing, "posture"> & {
  readonly posture?: Posture | undefined;
};

export const homeListing = ({
  asks,
  ledger,
  project,
}: {
  readonly asks: readonly AskListing[] | undefined;
  readonly ledger: Ledger | undefined;
  readonly project: ProjectName;
}): HomeListing => ({
  openAsks: asks?.length ?? 0,
  posture: ledger?.posture,
  project,
});

interface KnownPosture {
  readonly label: string;
  readonly posture: Posture;
}

export interface ProjectViewProps {
  readonly asks: readonly AskListing[] | undefined;
  readonly unreachable?: boolean;
  readonly landings: readonly LandingView[];
  readonly listing: HomeListing;
  readonly lastLanded?: DateTime.Utc | undefined;
  readonly postureLabel?: string | undefined;
  readonly heldBack?: readonly HeldBackArea[] | undefined;
  readonly deciders?: readonly Deciders[] | undefined;
  readonly importedFrom?: ImportSource | undefined;
  readonly now: DateTime.Utc;
  readonly platformUrl: string;
  readonly code?: ProjectCode | undefined;
  readonly parents?: readonly Ask[];
  readonly states?: ReadonlyMap<AskId, AskProgress>;
  readonly stamps?: ReadonlySet<AskId>;
  readonly selectedAsk?: Ask | undefined;
  readonly signedIn?: boolean;
}

const WhoDecides = ({
  deciders,
  project,
}: {
  readonly deciders: readonly Deciders[] | undefined;
  readonly project: ProjectName;
}) => {
  const shown = deciders?.slice(0, 3) ?? [];
  const more = (deciders?.length ?? 0) - shown.length;

  return (
    <FactBlock label="Who decides">
      {deciders === undefined || deciders.length === 0 ? (
        <p className="text-ui text-muted-foreground">
          Its policy names who decides for which paths.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map(({ handles, paths }) => (
            <li className="text-ui min-w-0" key={paths}>
              <MetaCode>{paths}</MetaCode>
              <span className="text-muted-foreground"> · </span>
              {handles.join(", ")}
            </li>
          ))}
          {more > 0 ? (
            <li className="text-ui text-muted-foreground">
              and {plural(more, "set of paths", "sets of paths")} more
            </li>
          ) : null}
        </ul>
      )}
      <Onward to={`/${project}/people`}>Policy</Onward>
    </FactBlock>
  );
};

const ImportedFrom = ({ source }: { readonly source: ImportSource }) => (
  <FactBlock label="Imported from">
    <p className="text-ui">
      <a
        className={`${LINK} [overflow-wrap:anywhere]`}
        href={source.url}
        rel="noreferrer"
      >
        {source.url}
      </a>
      {source.branch === undefined ? null : (
        <>
          {" "}
          · branch <MetaCode>{source.branch}</MetaCode>
        </>
      )}
    </p>
    <p className="text-ui text-muted-foreground">
      This project is {IMPORTED_NOTE}.
    </p>
  </FactBlock>
);

const TakePart = ({
  platformUrl,
  project,
}: {
  readonly platformUrl: string;
  readonly project: ProjectName;
}) => (
  <FactBlock label="Take part">
    <Step
      command={`git clone ${platformUrl}/${project}.git`}
      label="Clone it with plain git"
    />
    <Step
      command={`${Brand.cli} asks --project ${project}`}
      label="See what it asks for"
    />
    <Step
      command={`${Brand.cli} claim <ask>`}
      label="Claim one, in the clone"
    />
    <Step
      command={`${Brand.cli} check`}
      label="Check your answer before you push"
    />
  </FactBlock>
);

/**
 * Adopting main is not a landing event, so the replay may hold no landing:
 * never say "nothing landed".
 */
const RecentLandings = ({
  landedAt,
  landings,
  listing,
  now,
  platformUrl,
}: {
  readonly landedAt: DateTime.Utc | undefined;
  readonly landings: readonly LandingView[];
  readonly listing: HomeListing;
  readonly now: DateTime.Utc;
  readonly platformUrl: string;
}) => {
  let shown: ReactNode;

  if (landings.length > 0) {
    shown = <LandingList landings={recentShown(landings)} now={now} />;
  } else if (landedAt === undefined) {
    shown = (
      <>
        <p className="text-ui">
          Nothing has landed yet. The first push to main, by whoever ran init,
          lands it.
        </p>
        <CommandLine
          command={`git push ${platformUrl}/${listing.project}.git HEAD:main`}
        />
      </>
    );
  } else {
    shown = (
      <p className="text-ui text-muted-foreground">
        No landings among the recent events of {listing.project}.
      </p>
    );
  }

  return <FactBlock label="Recent landings">{shown}</FactBlock>;
};

const HowItLands = ({
  deciders,
  heldBack,
  importedFrom,
  landedAt,
  landings,
  listing,
  now,
  platformUrl,
}: Pick<
  ProjectViewProps,
  | "deciders"
  | "heldBack"
  | "importedFrom"
  | "landings"
  | "listing"
  | "now"
  | "platformUrl"
> & {
  readonly landedAt: DateTime.Utc | undefined;
}) => (
  <>
    <GateFacts />
    <WhoDecides deciders={deciders} project={listing.project} />
    {heldBack === undefined ? null : <HeldBackFacts areas={heldBack} />}
    {importedFrom === undefined ? null : <ImportedFrom source={importedFrom} />}
    <TakePart platformUrl={platformUrl} project={listing.project} />
    <RecentLandings
      landedAt={landedAt}
      landings={landings}
      listing={listing}
      now={now}
      platformUrl={platformUrl}
    />
    <ForAgents href={`/${listing.project}/llms.txt`} />
  </>
);

const RuleSentence = ({
  deciders,
  heldBack,
  landedAt,
  now,
  project,
}: {
  readonly deciders: readonly Deciders[] | undefined;
  readonly heldBack: readonly HeldBackArea[] | undefined;
  readonly landedAt: DateTime.Utc | undefined;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
}) => {
  const checks = (heldBack ?? []).reduce((sum, area) => sum + area.checks, 0);

  const sealed =
    heldBack === undefined ? undefined : (
      <AppLink className={LINK} key="ledger" to={ledgerPath(project)}>
        {heldBack.length === 0
          ? "nothing held back"
          : `${plural(checks, "sealed check", "sealed checks")} in ${plural(heldBack.length, "area", "areas")}`}
      </AppLink>
    );

  const parts = [
    `Gate: ${plural(StageName.literals.length, "stage", "stages")}`,
    deciders === undefined || deciders.length === 0
      ? undefined
      : `deciders set for ${plural(deciders.length, "path", "paths")}`,
    sealed,
    landedAt === undefined ? (
      "nothing landed yet"
    ) : (
      <span key="landed">
        last landed <When at={landedAt} now={now} />
      </span>
    ),
  ];

  return (
    <p className="text-ui text-muted-foreground max-w-[70ch]" data-rule="">
      <MetaLine parts={parts} />
    </p>
  );
};

const ProjectLine = ({
  count,
  lede,
  posture,
  rule,
}: {
  readonly count: number;
  readonly posture: KnownPosture | undefined;
  readonly lede: string | undefined;
  readonly rule: ReactNode;
}) => (
  <div className="flex flex-col gap-3">
    <p className="text-ui text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
      {/* Its dot after it, so a line never opens on one. */}
      {posture === undefined ? null : (
        <span className="flex items-center gap-x-2">
          <PostureBadge
            label={postureWord(posture.posture)}
            posture={posture.posture}
            title={posture.label}
          />
          <span aria-hidden="true">·</span>
        </span>
      )}
      <span className="tabular-nums">
        {plural(count, "open ask", "open asks")}
      </span>
    </p>
    {lede === undefined ? null : (
      <p className="text-want max-w-[70ch]">{lede}</p>
    )}
    {rule}
  </div>
);

const AsksSection = ({
  asks,
  now,
  onSelect,
  parents,
  project,
  selected,
  signedIn,
  stamps,
  states,
  unreachable,
}: {
  readonly asks: readonly AskListing[] | undefined;
  readonly now: DateTime.Utc;
  readonly unreachable: boolean;
  readonly project: ProjectName;
  readonly parents: readonly Ask[];
  readonly states: ReadonlyMap<AskId, AskProgress>;
  readonly stamps: ReadonlySet<AskId>;
  readonly selected: string | undefined;
  readonly onSelect: ((id: string) => void) | undefined;
  readonly signedIn: boolean;
}) => {
  let list: ReactNode;

  if (asks === undefined) {
    list = unreachable ? <UnreachableNotice /> : <ReadingRows />;
  } else if (asks.length === 0) {
    list = (
      <EmptyState
        command={`${Brand.cli} ask open <ask> --files <files>`}
        title="No open asks. A decider opens one from an ask file."
      />
    );
  } else {
    list = (
      <AskList
        asks={asks}
        now={now}
        onSelect={onSelect}
        parents={parents}
        project={project}
        selected={selected}
        stamps={stamps}
        states={states}
      />
    );
  }

  return (
    <section
      aria-labelledby="open-asks"
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <h2 className="text-title" id="open-asks">
          Open asks
        </h2>
        {signedIn ? <ProposeLink project={project} /> : null}
      </div>
      {list}
    </section>
  );
};

const PageFacts = ({
  landedAt,
  picked,
  posture,
  props,
  states,
}: {
  readonly props: ProjectViewProps;
  readonly picked: AskListing | undefined;
  readonly posture: KnownPosture | undefined;
  readonly landedAt: DateTime.Utc | undefined;
  readonly states: ReadonlyMap<AskId, AskProgress>;
}) => {
  const { listing, parents = [], platformUrl, selectedAsk } = props;

  if (picked === undefined) {
    return (
      <HowItLands
        deciders={props.deciders}
        heldBack={props.heldBack}
        importedFrom={props.importedFrom}
        landedAt={landedAt}
        landings={props.landings}
        listing={listing}
        now={props.now}
        platformUrl={platformUrl}
      />
    );
  }

  const family = parents.find(
    ({ blockedBy, id }) => id === picked.ask || blockedBy.includes(picked.ask)
  );

  return (
    <SelectedAskFacts
      family={
        family === undefined
          ? undefined
          : { finale: finaleOf(family.id), parent: family, states }
      }
      full={selectedAsk?.id === picked.ask ? selectedAsk : undefined}
      listing={picked}
      platformUrl={platformUrl}
      posture={posture}
      progress={states.get(picked.ask)}
      project={listing.project}
      takeable={openToTake(picked)}
    />
  );
};

const countOf = (open: readonly AskListing[]) =>
  `${plural(open.length, "open ask", "open asks")}, ${
    open.filter(openToTake).length
  } open to take`;

const ProjectPanes = ({
  props,
  select,
  selected,
}: {
  readonly props: ProjectViewProps;
  readonly selected: string | undefined;
  readonly select: ((id: string) => void) | undefined;
}) => {
  const { asks, code, listing } = props;
  const states = props.states ?? new Map<AskId, AskProgress>();
  const { project } = listing;

  const posture = Option.getOrUndefined(
    Option.map(
      Option.fromUndefinedOr(listing.posture),
      (known): KnownPosture => ({
        label: props.postureLabel ?? postureLabel(known),
        posture: known,
      })
    )
  );

  const landedAt = props.lastLanded ?? listing.landedAt;
  const open = Option.map(Option.fromUndefinedOr(asks), openAsks);
  const text = code?.readme?.text;

  return (
    <Workspace
      {...Option.match(open, {
        onNone: () => ({}),
        onSome: (each) => ({ count: countOf(each) }),
      })}
      crumbs={[{ label: project, to: `/${project}` }, { label: "Asks" }]}
      facts={
        <PageFacts
          landedAt={landedAt}
          picked={asks?.find(({ ask }) => ask === selected)}
          posture={posture}
          props={props}
          states={states}
        />
      }
      factsHeading={
        asks?.some(({ ask }) => ask === selected) === true
          ? "Selected ask"
          : "How a change lands here"
      }
      {...Option.match(Option.fromUndefinedOr(selected), {
        onNone: () => ({}),
        onSome: (factsKey) => ({ factsKey }),
      })}
      factsSummary={
        posture === undefined
          ? "Gate, who decides, take part"
          : postureWord(posture.posture)
      }
      status={
        <ProjectLine
          count={Option.match(open, {
            onNone: () => listing.openAsks,
            onSome: (each) => each.length,
          })}
          lede={Predicate.isString(text) ? ledeOf(text) : undefined}
          posture={posture}
          rule={
            <RuleSentence
              deciders={props.deciders}
              heldBack={props.heldBack}
              landedAt={landedAt}
              now={props.now}
              project={project}
            />
          }
        />
      }
      title={project}
      variant="list"
    >
      <ProjectNav current="overview" project={project} />
      <AsksSection
        asks={asks}
        now={props.now}
        onSelect={select}
        parents={props.parents ?? []}
        project={project}
        selected={selected}
        signedIn={props.signedIn === true}
        stamps={props.stamps ?? new Set()}
        states={states}
        unreachable={props.unreachable === true}
      />
      {code?.readme === undefined ? null : (
        <ReadmeSection file={code.readme} project={project} />
      )}
    </Workspace>
  );
};

const Selectable = ({ props }: { readonly props: ProjectViewProps }) => {
  const { select, selected } = useRowSelection(
    props.asks === undefined ? [] : askListIds(props.asks),
    "ask"
  );

  return <ProjectPanes props={props} select={select} selected={selected} />;
};

export const ProjectView = (given: ProjectViewProps) => {
  const props = {
    ...given,
    asks: given.asks && stillWaiting(given.asks),
  };

  return Predicate.isNotNullish(useRouter({ warn: false })) ? (
    <Selectable props={props} />
  ) : (
    <ProjectPanes props={props} select={undefined} selected={undefined} />
  );
};
