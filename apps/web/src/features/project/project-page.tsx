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
import { Predicate } from "effect";
import type { DateTime } from "effect";
import { LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";

import { ForAgents, Onward, plural } from "../front/facts.tsx";
import { stillWaiting } from "../front/families.ts";
import { ProposeLink } from "../propose/propose-link.tsx";
import type { AskProgress } from "../shared/ask-progress.ts";
import { LINK } from "../shared/classes.ts";
import { CommandLine } from "../shared/command.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { stageRuns } from "../shared/facts.tsx";
import { CommandSlotProvider } from "../shared/keys.tsx";
import { AppLink } from "../shared/link.tsx";
import { ReadingRows, UnreachableNotice } from "../shared/pending.tsx";
import { MetaCode, useRowSelection } from "../shared/row.tsx";
import { GUTTER } from "../shared/shell/gutter.ts";
import { stageNames } from "../shared/status-line.tsx";
import { AskList, askListIds, openAsks, openToTake } from "./asks.tsx";
import { LandingList, recentShown } from "./landings.tsx";
import { CloneSteps } from "./project-header.tsx";
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

export interface ProjectViewProps {
  readonly asks: readonly AskListing[] | undefined;
  readonly unreachable?: boolean;
  readonly landings: readonly LandingView[];
  readonly listing: HomeListing;
  readonly lastLanded?: DateTime.Utc | undefined;
  readonly heldBack?: readonly HeldBackArea[] | undefined;
  readonly deciders?: readonly Deciders[] | undefined;
  readonly importedFrom?: ImportSource | undefined;
  readonly now: DateTime.Utc;
  readonly platformUrl: string;
  readonly code?: ProjectCode | undefined;
  readonly parents?: readonly Ask[];
  readonly states?: ReadonlyMap<AskId, AskProgress>;
  readonly stamps?: ReadonlySet<AskId>;
  readonly signedIn?: boolean;
}

/** A plain bordered surface, its headline first (DESIGN.md "Cards"). */
const AboutCard = ({
  children,
  id,
  title,
}: {
  readonly title: string;
  readonly id: string;
  readonly children: ReactNode;
}) => (
  <section
    aria-labelledby={id}
    className="border-rule bg-card flex min-w-0 flex-col gap-3 rounded-md border p-4"
  >
    <h2 className="text-ui scroll-mt-(--stick-toolbar) font-semibold" id={id}>
      {title}
    </h2>
    {children}
  </section>
);

const HowItLands = () => (
  <AboutCard id="how-it-lands" title="How a change lands here">
    <p className="text-ui text-muted-foreground">
      Every answer is checked on the exact tree it would land as, by seven
      stages in turn.
    </p>
    <ol aria-label="Gate stages" className="flex flex-col gap-2">
      {StageName.literals.map((stage, at) => (
        <li className="flex min-w-0 gap-3" data-stage={stage} key={stage}>
          <span className="text-label text-muted-foreground w-4 shrink-0 pt-0.5 text-right tabular-nums">
            {at + 1}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-ui font-medium" data-term="">
              {stageNames(stage).label}
            </span>
            <span className="text-label text-muted-foreground font-normal">
              {stageRuns(stage)}
            </span>
          </span>
        </li>
      ))}
    </ol>
    <Onward to="/docs/landing">How a landing happens</Onward>
  </AboutCard>
);

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
    <AboutCard id="who-decides" title="Who decides">
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
    </AboutCard>
  );
};

/** The posture is the header's to say; this card says what is held back and where to read more. */
const VisibilitySummary = ({
  heldBack,
  project,
}: {
  readonly heldBack: readonly HeldBackArea[] | undefined;
  readonly project: ProjectName;
}) => {
  let held: ReactNode;

  if (heldBack === undefined) {
    held = null;
  } else if (heldBack.length === 0) {
    held = <p className="text-ui text-muted-foreground">Nothing held back</p>;
  } else {
    held = (
      <ul className="flex flex-col gap-1">
        {heldBack.map(({ area, detail }) => (
          <li
            className="text-ui text-sealed flex items-start gap-2"
            data-area={area}
            key={area}
          >
            <LockKeyhole
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
              strokeWidth={1.75}
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="text-mono font-mono">{area}</span>: {detail}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <AboutCard id="visibility" title="Visibility">
      {held}
      <p className="text-ui flex flex-wrap gap-x-4 gap-y-1">
        <AppLink className={LINK} to={`/${project}/ledger`}>
          Ledger
        </AppLink>
        <AppLink className={LINK} to={`/${project}/env`}>
          Env shape
        </AppLink>
      </p>
    </AboutCard>
  );
};

const ImportedFrom = ({ source }: { readonly source: ImportSource }) => (
  <AboutCard id="imported-from" title="Imported from">
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
  </AboutCard>
);

const About = ({ props }: { readonly props: ProjectViewProps }) => {
  const { project } = props.listing;

  return (
    <aside
      aria-label="About"
      className="flex min-w-0 flex-col gap-4"
      data-column="about"
    >
      <AboutCard id="clone" title="Clone">
        <CloneSteps platformUrl={props.platformUrl} project={project} />
      </AboutCard>
      <HowItLands />
      <WhoDecides deciders={props.deciders} project={project} />
      <VisibilitySummary heldBack={props.heldBack} project={project} />
      {props.importedFrom === undefined ? null : (
        <ImportedFrom source={props.importedFrom} />
      )}
      <ForAgents href={`/${project}/llms.txt`} />
    </aside>
  );
};

const SectionHead = ({
  action,
  count,
  id,
  title,
}: {
  readonly id: string;
  readonly title: string;
  readonly count?: string | undefined;
  readonly action?: ReactNode;
}) => (
  <div className="flex min-h-8 flex-wrap items-baseline gap-x-3 gap-y-1">
    <h2 className="text-title scroll-mt-(--stick-toolbar)" id={id}>
      {title}
    </h2>
    {count === undefined ? null : (
      <span className="text-label text-muted-foreground tabular-nums">
        {count}
      </span>
    )}
    {action === undefined ? null : <span className="ml-auto">{action}</span>}
  </div>
);

/**
 * Adopting main is not a landing event, so the replay may hold no landing:
 * never say "nothing landed".
 */
const RecentLandings = ({
  landedAt,
  landings,
  now,
  platformUrl,
  project,
}: {
  readonly landedAt: DateTime.Utc | undefined;
  readonly landings: readonly LandingView[];
  readonly now: DateTime.Utc;
  readonly platformUrl: string;
  readonly project: ProjectName;
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
          command={`git push ${platformUrl}/${project}.git HEAD:main`}
        />
      </>
    );
  } else {
    shown = (
      <p className="text-ui text-muted-foreground">
        No landings among the recent events of {project}.
      </p>
    );
  }

  return (
    <section
      aria-labelledby="recent-landings"
      className="flex min-w-0 flex-col gap-2"
    >
      <SectionHead
        action={<Onward to={`/${project}/commits/main`}>Every landing</Onward>}
        id="recent-landings"
        title="Recent landings"
      />
      {shown}
    </section>
  );
};

const countOf = (open: readonly AskListing[]) =>
  `${plural(open.length, "open ask", "open asks")}, ${
    open.filter(openToTake).length
  } open to take`;

const AsksSection = ({
  asks,
  now,
  parents,
  project,
  selected,
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
}) => {
  let list: ReactNode;

  if (asks === undefined) {
    list = unreachable ? <UnreachableNotice /> : <ReadingRows />;
  } else if (asks.length === 0) {
    list = (
      <EmptyState
        command={`${Brand.cli} ask open <ask> --files <files>`}
        title="No open asks. A maintainer opens one from an ask file."
      />
    );
  } else {
    list = (
      <AskList
        asks={asks}
        now={now}
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
      <SectionHead
        count={asks === undefined ? undefined : countOf(openAsks(asks))}
        id="open-asks"
        title="Open asks"
      />
      {list}
    </section>
  );
};

/**
 * The Proposals tab opens this region until a project's proposals have a
 * page of their own, so the tab keeps the project's header and tabs.
 */
const ProposalsSection = ({
  project,
  signedIn,
}: {
  readonly project: ProjectName;
  readonly signedIn: boolean;
}) => (
  <section aria-labelledby="proposals" className="flex min-w-0 flex-col gap-2">
    <SectionHead
      action={signedIn ? <ProposeLink project={project} /> : undefined}
      id="proposals"
      title="Proposals"
    />
    <p className="text-ui text-muted-foreground max-w-(--measure)">
      A proposal asks a maintainer to open an ask. An agent on the platform
      drafts its ask file and check, and it expires unless a maintainer accepts
      it.
      {signedIn ? null : " Sign in to propose one."}
    </p>
  </section>
);

/**
 * Overview: open asks, recent landings, proposals and the README in the main column,
 * and the about column beside it from `columns`, under it below.
 */
const ProjectPanes = ({
  props,
  selected,
}: {
  readonly props: ProjectViewProps;
  readonly selected: string | undefined;
}) => {
  const { asks, code, listing } = props;
  const states = props.states ?? new Map<AskId, AskProgress>();
  const { project } = listing;

  return (
    <main
      className="flex min-w-0 flex-1 flex-col outline-none"
      data-scroll-restoration-id="main"
      data-variant="overview"
      id="main"
      tabIndex={-1}
    >
      <CommandSlotProvider slot="main">
        <div
          className={`columns:grid columns:grid-cols-[minmax(0,1fr)_var(--column-about)] columns:items-start flex flex-col gap-10 pt-6 pb-16 ${GUTTER}`}
        >
          <div className="flex min-w-0 flex-col gap-8">
            <AsksSection
              asks={asks}
              now={props.now}
              parents={props.parents ?? []}
              project={project}
              selected={selected}
              stamps={props.stamps ?? new Set()}
              states={states}
              unreachable={props.unreachable === true}
            />
            <RecentLandings
              landedAt={props.lastLanded ?? listing.landedAt}
              landings={props.landings}
              now={props.now}
              platformUrl={props.platformUrl}
              project={project}
            />
            <ProposalsSection
              project={project}
              signedIn={props.signedIn === true}
            />
            {code?.readme === undefined ? null : (
              <div className="max-w-(--measure) min-w-0">
                <ReadmeSection file={code.readme} project={project} />
              </div>
            )}
          </div>
          <About props={props} />
        </div>
      </CommandSlotProvider>
    </main>
  );
};

const Selectable = ({ props }: { readonly props: ProjectViewProps }) => {
  const { selected } = useRowSelection(
    props.asks === undefined ? [] : askListIds(props.asks),
    "ask"
  );

  return <ProjectPanes props={props} selected={selected} />;
};

export const ProjectView = (given: ProjectViewProps) => {
  const props = {
    ...given,
    asks: given.asks && stillWaiting(given.asks),
  };

  return Predicate.isNotNullish(useRouter({ warn: false })) ? (
    <Selectable props={props} />
  ) : (
    <ProjectPanes props={props} selected={undefined} />
  );
};
