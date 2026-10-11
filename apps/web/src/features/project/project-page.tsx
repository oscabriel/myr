/**
 * A project's home, which is its list of asks: its name, its posture and
 * when it last landed; its open asks, a family drawn as a fan with its
 * children listed; then its README. Beside them, how a change lands here:
 * the posture, the gate, who decides, what is held back, the commands that
 * take part, and the last landings; or the selected ask's facts, one Escape
 * from them. Props in, markup out: the route reads the asks, the ledger,
 * the events, the policy and the code on the server and keeps them live in
 * the browser, and hands them here.
 */
import { IMPORTED_NOTE } from "@repo/agent-kit/docs/imported-note";
import { Brand } from "@repo/brand";
import type { Ask, AskListing } from "@repo/protocol/domain/ask";
import type { FileView, TreeListing } from "@repo/protocol/domain/code";
import type { Glob } from "@repo/protocol/domain/common";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import type { LandingView } from "@repo/protocol/domain/landing";
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
import {
  FactBlock,
  GateFacts,
  HeldBackFacts,
  PostureFacts,
} from "../shared/facts.tsx";
import { ReadingRows, UnreachableNotice } from "../shared/pending.tsx";
import { PostureBadge } from "../shared/posture.tsx";
import { MetaCode, useRowSelection } from "../shared/row.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { FactsSkeleton } from "../shared/skeleton.tsx";
import { When } from "../shared/time.tsx";
import { AskList, askListIds, openAsks, openToTake } from "./asks.tsx";
import { LandingList, recentShown } from "./landings.tsx";
import { postureLabel } from "./posture-label.ts";
import { ProjectNav } from "./project-nav.tsx";
import { ReadmeSection } from "./readme-section.tsx";

/** A project's code as its home reads it: the root folder at main, and its README. */
export interface ProjectCode {
  readonly readme?: FileView | undefined;
  readonly root: TreeListing;
}

/** Who decides for which paths, as the project's policy says. */
export interface Deciders {
  readonly handles: readonly Handle[];
  readonly paths: Glob;
}

/** One area a layer holds checks in, and how many. */
export interface HeldBackArea {
  readonly area: AreaName;
  readonly detail: string;
}

/** An entry that says nothing about an area's count. */
const noCount = (): readonly (readonly [AreaName, number])[] => [];

/**
 * What a project holds back, from its ledger: each sealed area and how many
 * checks it holds, as the latest count or commitment says.
 */
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
      detail: `${count} sealed ${count === 1 ? "check" : "checks"}`,
    }));
};

/**
 * The project as its home knows it: its name, its open asks, when it last
 * landed, and its posture once its own ledger has said it. Until then the
 * page says no posture, never one it was not told.
 */
export type HomeListing = Omit<ProjectListing, "posture"> & {
  readonly posture?: Posture | undefined;
};

/** The project for its home, from what was read: the posture only from its own ledger. */
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

/** A posture known, in the platform's words. */
interface KnownPosture {
  readonly label: string;
  readonly posture: Posture;
}

export interface ProjectViewProps {
  /** The open asks; none while they are read, and none when they could not be. */
  readonly asks: readonly AskListing[] | undefined;
  /** Whether the asks could not be read: the platform did not answer. */
  readonly unreachable?: boolean;
  /** The project's landings, newest first. */
  readonly landings: readonly LandingView[];
  /** The project: its posture (once its ledger is read), when it last landed, its open asks. */
  readonly listing: HomeListing;
  /** When it last landed, as its events say, over what the listing says. */
  readonly lastLanded?: DateTime.Utc | undefined;
  /** Its posture in the platform's words, from its own ledger. */
  readonly postureLabel?: string | undefined;
  /** What it holds back, from its ledger; none while it is read. */
  readonly heldBack?: readonly HeldBackArea[] | undefined;
  /** Who decides for which paths; none while the policy is read or when it has none. */
  readonly deciders?: readonly Deciders[] | undefined;
  /** Where it was imported from; none for a project that started empty, or while the policy is read. */
  readonly importedFrom?: ImportSource | undefined;
  readonly now: DateTime.Utc;
  readonly platformUrl: string;
  /** The root folder at main and its README, once read. */
  readonly code?: ProjectCode | undefined;
  /** Each family's parent in full, which counts its children. */
  readonly parents?: readonly Ask[];
  /** Where each ask stands, from the project's events. */
  readonly states?: ReadonlyMap<AskId, AskProgress>;
  /** The children that landed while the page was open. */
  readonly stamps?: ReadonlySet<AskId>;
  /** The selected ask in full, once the browser has read it. */
  readonly selectedAsk?: Ask | undefined;
  /** Whether someone is signed in, who may propose an ask. */
  readonly signedIn?: boolean;
}

/** Who decides, one line per set of paths, at most three, then the policy. */
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

/** Where an imported project came from: its source, the branch adopted, and what a copy is. */
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

/** The four commands that take part, in the order a newcomer runs them. */
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
 * The last landings. Before the project's main first lands, the push that
 * lands it is its initializer's; after it, the replay may still hold no
 * landing event, since adopting main is not one: say so, never "nothing
 * landed".
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

/** How a change lands here: the facts with nothing selected. */
const HowItLands = ({
  deciders,
  heldBack,
  importedFrom,
  landedAt,
  landings,
  listing,
  now,
  platformUrl,
  posture,
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
  readonly posture: KnownPosture | undefined;
  readonly landedAt: DateTime.Utc | undefined;
}) => (
  <>
    {posture === undefined ? (
      <FactsSkeleton labels={["Posture"]} />
    ) : (
      <PostureFacts
        label={posture.label}
        posture={posture.posture}
        project={listing.project}
      />
    )}
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

/** The project line: its posture, its open asks, when it last landed; then its README's first sentence. */
const ProjectLine = ({
  count,
  landedAt,
  lede,
  now,
  posture,
}: {
  readonly count: number;
  readonly posture: KnownPosture | undefined;
  readonly landedAt: DateTime.Utc | undefined;
  readonly lede: string | undefined;
  readonly now: DateTime.Utc;
}) => (
  <div className="flex flex-col gap-3">
    <p className="text-ui text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
      {/* Each part keeps its dot after it, so a line never opens on one; on
          a phone the posture has a line of its own. */}
      {posture === undefined ? null : (
        <span className="max-tablet:basis-full flex items-center gap-x-2">
          <PostureBadge label={posture.label} posture={posture.posture} />
          <span aria-hidden="true" className="max-tablet:hidden">
            ·
          </span>
        </span>
      )}
      <span className="inline-flex gap-x-2 tabular-nums">
        {plural(count, "open ask", "open asks")}
        <span aria-hidden="true">·</span>
      </span>
      <span>
        {landedAt === undefined ? (
          "nothing landed yet"
        ) : (
          <>
            last landed <When at={landedAt} now={now} />
          </>
        )}
      </span>
    </p>
    {lede === undefined ? null : (
      <p className="text-want max-w-[70ch]">{lede}</p>
    )}
  </div>
);

/** The asks' place on the page, as far as they have been read. */
const AsksSection = ({
  asks,
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

/** Whichever facts the inspector shows: how a change lands here, or the selected ask's. */
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
        posture={posture}
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

/** A list's count at the context bar's end: "7 open asks, 6 open to take". */
const countOf = (open: readonly AskListing[]) =>
  `${plural(open.length, "open ask", "open asks")}, ${
    open.filter(openToTake).length
  } open to take`;

/** The page, with the selection the list keeps (or none, outside a router). */
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
      factsSummary={posture?.label ?? "Posture, gate, who decides, take part"}
      status={
        <ProjectLine
          count={Option.match(open, {
            onNone: () => listing.openAsks,
            onSome: (each) => each.length,
          })}
          landedAt={landedAt}
          lede={Predicate.isString(text) ? ledeOf(text) : undefined}
          now={props.now}
          posture={posture}
        />
      }
      title={project}
      variant="list"
    >
      <ProjectNav current="overview" project={project} />
      <AsksSection
        asks={asks}
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

/**
 * The project's home. Inside the router its list selects (`?ask=`) and `j`
 * and `k` walk it; a view rendered alone draws the same page with nothing
 * selected.
 */
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
