/**
 * The front page: the open asks of every project, grouped by project, the
 * ones the viewer may take first; a family drawn as one row with its fan;
 * a toolbar that narrows the list by kind, by who may take an ask and by
 * project; and beside it, where to start, or the selected ask's facts.
 * Props in, markup out: the route reads the entries, the families' parents
 * and their projects' events on the server, the list of projects in the
 * browser (it may arrive after the rows, and moves none of them), and
 * hands them here.
 *
 * Each project's posture is said once, on its group's header, from the
 * list of projects; a row says only its own state. The filter is a link
 * (`/asks?kind=bug&take=open`), so a filtered list is an address to share.
 */
import { Brand } from "@repo/brand";
import { Reserve } from "@repo/protocol/domain/ask";
import type { Ask } from "@repo/protocol/domain/ask";
import type { ProjectEvent } from "@repo/protocol/domain/event";
import type {
  FrontPageEntry,
  ProjectListing,
} from "@repo/protocol/domain/front-page";
import type { AskId, KindName, ProjectName } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import { ChevronDown } from "lucide-react";
import { useMemo } from "react";
import type { ReactNode } from "react";

import { postureLabel } from "../project/posture-label.ts";
import { askStates } from "../shared/ask-progress.ts";
import type { AskProgress } from "../shared/ask-progress.ts";
import { EmptyState } from "../shared/empty.tsx";
import { FamilyStrip } from "../shared/family.tsx";
import { AppLink } from "../shared/link.tsx";
import { projectPath } from "../shared/paths.ts";
import { PostureBadge } from "../shared/posture.tsx";
import { AskRow, RowGroup, useRowSelection } from "../shared/row.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import {
  ProjectsFacts,
  SelectedAskFacts,
  StartHere,
  plural,
} from "./facts.tsx";
import { arrange, finaleOf } from "./families.ts";
import type { Arranged } from "./families.ts";
import { countWith, filterEntries, frontPath } from "./filter.ts";
import type { FrontFilter, FrontFilterInput } from "./filter.ts";
import { EXPLAINER } from "./head.ts";

/** The list's count, as the context bar says it: "10 open asks, 8 open to take". */
export const frontCount = (shown: readonly FrontPageEntry[]) =>
  `${plural(shown.length, "open ask", "open asks")}, ${
    shown.filter(({ takeable }) => takeable).length
  } open to take`;

export interface FrontPageProps {
  readonly entries: readonly FrontPageEntry[];
  readonly filter: FrontFilter;
  readonly now: DateTime.Utc;
  /** Each family's parent as the platform stores it: its children, all of them. */
  readonly parents: readonly Ask[];
  /** The events of each project that holds a family on the page. */
  readonly events: ReadonlyMap<ProjectName, readonly ProjectEvent[]>;
  /** The children that landed while the page was open, by project. */
  readonly stampsOf?: (project: ProjectName) => ReadonlySet<AskId>;
  /** Every project with its posture; none until the list arrives. */
  readonly projects: readonly ProjectListing[] | undefined;
  readonly platformUrl: string;
  readonly webUrl: string;
  /** The selected ask in full, once the browser has read it. */
  readonly selectedAsk?: Ask | undefined;
}

/** The entries of each project, in the order its first entry comes. */
const byProject = (shown: readonly FrontPageEntry[]) => {
  const groups = new Map<ProjectName, FrontPageEntry[]>();

  for (const entry of shown) {
    groups.set(entry.project, [...(groups.get(entry.project) ?? []), entry]);
  }

  return [...groups];
};

/** One option of a filter: its words and its count, the current one marked. */
const FilterOption = ({
  count,
  current,
  label,
  search,
}: {
  readonly count: number;
  readonly current: boolean;
  readonly label: string;
  readonly search: FrontFilterInput;
}) => (
  <li className="shrink-0">
    <AppLink
      activeOptions={{ exact: true, includeSearch: true }}
      aria-current={current ? "page" : undefined}
      className="text-ui text-muted-foreground hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground flex h-10 items-center gap-1.5 border-b-2 border-transparent whitespace-nowrap no-underline transition-colors duration-[120ms] focus-visible:outline-offset-[-2px] aria-[current=page]:font-semibold"
      to={frontPath(search)}
    >
      {label}
      <span className="text-label text-muted-foreground font-normal tabular-nums">
        {count}
      </span>
    </AppLink>
  </li>
);

/** A filter's options, under its name for a screen reader. */
const Segment = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) => (
  <ul aria-label={label} className="flex shrink-0 items-center gap-4">
    {children}
  </ul>
);

/** The kinds on the page, and the one filtered to, each once, by name. */
const kindsOf = (entries: readonly FrontPageEntry[], filter: FrontFilter) =>
  [
    ...new Set([
      ...entries.map(({ ask }) => ask.kind),
      ...(filter.kind === undefined ? [] : [filter.kind]),
    ]),
  ].toSorted();

/** The projects on the page, and the one filtered to, each once, by name. */
const projectsOf = (entries: readonly FrontPageEntry[], filter: FrontFilter) =>
  [
    ...new Set([
      ...entries.map(({ project }) => project),
      ...(filter.project === undefined ? [] : [filter.project]),
    ]),
  ].toSorted();

const reserveWords = {
  newcomers: "Held for newcomers",
  people: "Held for people",
} as const satisfies Record<Reserve, string>;

/**
 * The projects as a menu: a disclosure of links, so it opens and narrows
 * with no script. A new address closes it (its key is the filter's
 * project).
 */
const ProjectMenu = ({
  entries,
  filter,
}: {
  readonly entries: readonly FrontPageEntry[];
  readonly filter: FrontFilter;
}) => (
  <details
    className="group relative shrink-0"
    key={filter.project ?? "every project"}
  >
    <summary className="text-ui hover:bg-surface flex h-8 cursor-pointer list-none items-center gap-1.5 px-2 whitespace-nowrap transition-colors duration-[120ms] [&::-webkit-details-marker]:hidden">
      <span className="text-muted-foreground">Project</span>
      <span className="font-semibold">{filter.project ?? "All"}</span>
      <ChevronDown
        aria-hidden="true"
        className="text-muted-foreground size-4 transition-transform duration-150 group-open:rotate-180"
        strokeWidth={1.75}
      />
    </summary>
    <ul
      aria-label="Projects"
      className="border-rule bg-popover absolute top-full right-0 z-30 mt-1 flex max-h-80 w-56 flex-col overflow-y-auto border py-1"
    >
      {[undefined, ...projectsOf(entries, filter)].map((project) => (
        <li key={project ?? "every project"}>
          <AppLink
            aria-current={filter.project === project ? "page" : undefined}
            className="text-ui hover:bg-surface aria-[current=page]:bg-surface flex h-9 items-center justify-between gap-3 px-3 no-underline aria-[current=page]:font-semibold"
            to={frontPath({ ...filter, project })}
          >
            <span className="truncate">{project ?? "Every project"}</span>
            <span className="text-label text-muted-foreground font-normal tabular-nums">
              {countWith(entries, filter, { project })}
            </span>
          </AppLink>
        </li>
      ))}
    </ul>
  </details>
);

/** The toolbar: kind; open to take or held for newcomers; project. */
const Toolbar = ({
  entries,
  filter,
}: {
  readonly entries: readonly FrontPageEntry[];
  readonly filter: FrontFilter;
}) => {
  const held = Reserve.literals.filter((reserved) =>
    entries.some(({ ask }) => ask.reserve === reserved)
  );

  return (
    <>
      <nav
        aria-label="Filter the asks"
        className="max-shell:pr-8 max-shell:[mask-image:linear-gradient(to_right,#000_calc(100%-2rem),transparent)] flex min-w-0 flex-1 [scrollbar-width:none] items-center gap-6 overflow-x-auto overscroll-x-contain"
      >
        <Segment label="Kind">
          <FilterOption
            count={countWith(entries, filter, { kind: undefined })}
            current={filter.kind === undefined}
            label="All"
            search={{ ...filter, kind: undefined }}
          />
          {kindsOf(entries, filter).map((kind: KindName) => (
            <FilterOption
              count={countWith(entries, filter, { kind })}
              current={filter.kind === kind}
              key={kind}
              label={kind}
              search={{ ...filter, kind }}
            />
          ))}
        </Segment>
        <span aria-hidden="true" className="bg-rule h-4 w-px shrink-0" />
        <Segment label="Who may take it">
          <FilterOption
            count={countWith(entries, filter, {
              reserved: undefined,
              take: undefined,
            })}
            current={filter.take === undefined && filter.reserved === undefined}
            label="Any"
            search={{ ...filter, reserved: undefined, take: undefined }}
          />
          <FilterOption
            count={countWith(entries, filter, {
              reserved: undefined,
              take: "open",
            })}
            current={filter.take === "open"}
            label="Open to take"
            search={{ ...filter, reserved: undefined, take: "open" }}
          />
          {held.map((reserved) => (
            <FilterOption
              count={countWith(entries, filter, { reserved, take: undefined })}
              current={filter.reserved === reserved}
              key={reserved}
              label={reserveWords[reserved]}
              search={{ ...filter, reserved, take: undefined }}
            />
          ))}
        </Segment>
      </nav>
      <ProjectMenu entries={entries} filter={filter} />
    </>
  );
};

/**
 * The front page with no open ask: with no project yet, the command that
 * brings one; with projects, the command that opens an ask.
 */
const NoAsks = ({
  projects,
}: {
  readonly projects: readonly ProjectListing[] | undefined;
}) =>
  projects?.length === 0 ? (
    <EmptyState
      command={`${Brand.cli} init`}
      title="No open asks, and no project yet. Run init in a repo to bring it here."
    />
  ) : (
    <EmptyState
      command={`${Brand.cli} ask open <ask> --files <files>`}
      title="No open asks on any project. A decider opens one from an ask file."
    />
  );

/** A project's group of rows, as the page reads it. */
interface Group {
  readonly project: ProjectName;
  readonly entries: readonly FrontPageEntry[];
  readonly items: readonly Arranged[];
  readonly states: ReadonlyMap<AskId, AskProgress>;
}

/** The row ids in the order the page shows them: what `j` and `k` walk. */
const rowIds = (groups: readonly Group[]) =>
  groups.flatMap(({ items }) =>
    items.map((item) =>
      item.kind === "ask" ? item.listing.ask : item.parent.ask
    )
  );

/** A project's group: its header (name, posture once, counts), then its rows. */
const ProjectGroup = ({
  group,
  listing,
  now,
  onSelect,
  parents,
  selected,
  stamps,
}: {
  readonly group: Group;
  readonly listing: ProjectListing | undefined;
  readonly now: DateTime.Utc;
  readonly parents: readonly Ask[];
  readonly selected: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly stamps: ReadonlySet<AskId>;
}) => {
  const { entries, items, project, states } = group;
  const takeable = new Map(entries.map((entry) => [entry.ask.ask, entry]));

  const row = (listingOf: FrontPageEntry["ask"], strip?: ReactNode) => (
    <AskRow
      key={listingOf.ask}
      listing={listingOf}
      now={now}
      onSelect={onSelect}
      progress={states.get(listingOf.ask)}
      project={project}
      selected={selected === listingOf.ask}
      strip={strip}
      takeable={takeable.get(listingOf.ask)?.takeable}
    />
  );

  return (
    <RowGroup
      counts={`${entries.length} open · ${
        entries.filter((entry) => entry.takeable).length
      } to take`}
      facts={
        listing === undefined ? undefined : (
          <PostureBadge
            label={postureLabel(listing.posture)}
            posture={listing.posture}
          />
        )
      }
      label={project}
      name={<AppLink to={projectPath(project)}>{project}</AppLink>}
    >
      {items.flatMap((item) => {
        if (item.kind === "ask") {
          return [row(item.listing)];
        }

        const parent = parents.find(
          (ask) => ask.project === project && ask.id === item.parent.ask
        );

        // A parent the platform did not give in full: its members stay rows.
        if (parent === undefined) {
          return [
            row(item.parent),
            ...item.members.map((member) => row(member)),
          ];
        }

        return [
          row(
            item.parent,
            <FamilyStrip
              expanded={false}
              finale={item.finale}
              parent={parent}
              project={project}
              stamps={stamps}
              states={states}
              wants={
                new Map(item.members.map((member) => [member.ask, member.want]))
              }
            />
          ),
        ];
      })}
    </RowGroup>
  );
};

/** The selected entry's facts, with its family when it is a member. */
const Selected = ({
  entry,
  full,
  parents,
  platformUrl,
  projects,
  states,
}: {
  readonly entry: FrontPageEntry;
  readonly full: Ask | undefined;
  readonly parents: readonly Ask[];
  readonly platformUrl: string;
  readonly projects: readonly ProjectListing[] | undefined;
  readonly states: ReadonlyMap<AskId, AskProgress>;
}) => {
  const { ask, project, takeable } = entry;

  const parent = parents.find(
    (each) =>
      each.project === project &&
      (each.id === ask.ask || each.blockedBy.includes(ask.ask))
  );

  const listed = projects?.find((each) => each.project === project);

  return (
    <SelectedAskFacts
      family={
        parent === undefined
          ? undefined
          : {
              finale: finaleOf(parent.id),
              parent,
              states,
            }
      }
      full={full?.id === ask.ask && full.project === project ? full : undefined}
      listing={ask}
      platformUrl={platformUrl}
      posture={
        listed === undefined
          ? undefined
          : { label: postureLabel(listed.posture), posture: listed.posture }
      }
      progress={states.get(ask.ask)}
      project={project}
      takeable={takeable}
    />
  );
};

export const FrontPageView = ({
  entries,
  events,
  filter,
  now,
  parents,
  platformUrl,
  projects,
  selectedAsk,
  stampsOf,
  webUrl,
}: FrontPageProps) => {
  const shown = filterEntries(entries, filter);

  const states = useMemo(
    () =>
      new Map(
        [...events].map(
          ([project, read]) => [project, askStates(read)] as const
        )
      ),
    [events]
  );

  const groups: readonly Group[] = byProject(shown).map(
    ([project, grouped]) => ({
      entries: grouped,
      items: arrange(grouped.map(({ ask }) => ask)),
      project,
      states: states.get(project) ?? new Map(),
    })
  );

  const { select, selected } = useRowSelection(rowIds(groups), "ask");
  const picked = entries.find(({ ask }) => ask.ask === selected);

  return (
    <Workspace
      count={frontCount(shown)}
      crumbs={[{ label: "Asks" }]}
      facts={
        picked === undefined ? (
          <>
            <StartHere webUrl={webUrl} />
            <ProjectsFacts projects={projects} />
          </>
        ) : (
          <Selected
            entry={picked}
            full={selectedAsk}
            parents={parents}
            platformUrl={platformUrl}
            projects={projects}
            states={states.get(picked.project) ?? new Map()}
          />
        )
      }
      factsHeading={picked === undefined ? "Start here" : "Selected ask"}
      {...(selected === undefined ? {} : { factsKey: selected })}
      factsSummary={
        picked === undefined
          ? "Install the command line, list the asks, claim one"
          : picked.ask.want
      }
      status={
        <p className="text-want text-muted-foreground max-w-[70ch]">
          {EXPLAINER}
        </p>
      }
      title="Open asks"
      toolbar={
        entries.length === 0 ? undefined : (
          <Toolbar entries={entries} filter={filter} />
        )
      }
      variant="list"
    >
      {entries.length === 0 ? <NoAsks projects={projects} /> : null}
      {entries.length > 0 && shown.length === 0 ? (
        <EmptyState
          onward={
            <AppLink
              className="decoration-rule underline hover:decoration-current"
              to={frontPath({})}
            >
              Show every open ask
            </AppLink>
          }
          title="No open asks match this filter."
        />
      ) : null}
      {groups.length === 0 ? null : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <ProjectGroup
              group={group}
              key={group.project}
              listing={projects?.find(
                ({ project }) => project === group.project
              )}
              now={now}
              onSelect={select}
              parents={parents}
              selected={selected}
              stamps={stampsOf?.(group.project) ?? new Set()}
            />
          ))}
        </div>
      )}
    </Workspace>
  );
};
