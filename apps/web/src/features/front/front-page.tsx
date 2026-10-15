import { Reserve } from "@repo/protocol/domain/ask";
import type { Ask } from "@repo/protocol/domain/ask";
import type { ProjectEvent } from "@repo/protocol/domain/event";
import type {
  FrontPageEntry,
  ProjectListing,
} from "@repo/protocol/domain/front-page";
import type { AskId, KindName, ProjectName } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import { useId, useMemo } from "react";
import type { ReactNode } from "react";

import { postureLabel } from "../project/posture-label.ts";
import { askStates } from "../shared/ask-progress.ts";
import type { AskProgress } from "../shared/ask-progress.ts";
import { EmptyState } from "../shared/empty.tsx";
import { FamilyStrip } from "../shared/family.tsx";
import { AppLink } from "../shared/link.tsx";
import { IMPORT_PATH, projectPath, TOUR_PATH } from "../shared/paths.ts";
import { PostureBadge } from "../shared/posture.tsx";
import { AskRow, RowGroup, useRowSelection } from "../shared/row.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { plural } from "./facts.tsx";
import { arrange } from "./families.ts";
import type { Arranged } from "./families.ts";
import { compact, countWith, filterEntries, frontPath } from "./filter.ts";
import type { FrontFilter, FrontFilterInput } from "./filter.ts";
import { EXPLAINER } from "./head.ts";

export const frontCount = (shown: readonly FrontPageEntry[]) =>
  `${plural(shown.length, "open ask", "open asks")}, ${
    shown.filter(({ takeable }) => takeable).length
  } open to take`;

export interface FrontPageProps {
  readonly entries: readonly FrontPageEntry[];
  readonly filter: FrontFilter;
  readonly now: DateTime.Utc;
  readonly parents: readonly Ask[];
  readonly events: ReadonlyMap<ProjectName, readonly ProjectEvent[]>;
  readonly stampsOf?: (project: ProjectName) => ReadonlySet<AskId>;
  readonly projects: readonly ProjectListing[] | undefined;
}

const byProject = (shown: readonly FrontPageEntry[]) => {
  const groups = new Map<ProjectName, FrontPageEntry[]>();

  for (const entry of shown) {
    groups.set(entry.project, [...(groups.get(entry.project) ?? []), entry]);
  }

  return [...groups];
};

const OPTION =
  "text-ui text-muted-foreground hover:bg-surface/50 hover:text-foreground aria-[current=page]:bg-surface aria-[current=page]:text-foreground flex min-h-8 min-w-0 items-center justify-between gap-3 px-2 no-underline transition-colors duration-[120ms] focus-visible:outline-offset-[-2px] aria-[current=page]:font-semibold";

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
  <li className="min-w-0">
    <AppLink
      activeOptions={{ exact: true, includeSearch: true }}
      aria-current={current ? "page" : undefined}
      className={OPTION}
      to={frontPath(search)}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="text-label text-muted-foreground shrink-0 font-normal tabular-nums">
        {count}
      </span>
    </AppLink>
  </li>
);

const Facet = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) => {
  const heading = useId();

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 className="text-ui px-2 font-semibold" id={heading}>
        {label}
      </h2>
      <ul aria-labelledby={heading} className="flex min-w-0 flex-col">
        {children}
      </ul>
    </div>
  );
};

const kindsOf = (entries: readonly FrontPageEntry[], filter: FrontFilter) =>
  [
    ...new Set([
      ...entries.map(({ ask }) => ask.kind),
      ...(filter.kind === undefined ? [] : [filter.kind]),
    ]),
  ].toSorted();

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

const LINK = "decoration-rule underline hover:decoration-current";

/**
 * The board's left column: links, so every filter is an address and works
 * with no script. Each option keeps the other filters as they are.
 */
const Filters = ({
  entries,
  filter,
}: {
  readonly entries: readonly FrontPageEntry[];
  readonly filter: FrontFilter;
}) => {
  const held = Reserve.literals.filter(
    (reserved) =>
      entries.some(({ ask }) => ask.reserve === reserved) ||
      filter.reserved === reserved
  );

  const filtered = Object.keys(compact(filter)).length > 0;

  return (
    <nav
      aria-label="Filter the asks"
      className="columns:sticky columns:top-[calc(var(--top-bar)+1.5rem)] columns:max-h-[calc(100dvh-var(--top-bar)-3rem)] columns:overflow-y-auto tablet:grid-cols-3 columns:flex columns:flex-col columns:self-start -mx-2 grid min-w-0 gap-6"
    >
      <Facet label="Kind">
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
      </Facet>
      <Facet label="State">
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
      </Facet>
      <Facet label="Project">
        <FilterOption
          count={countWith(entries, filter, { project: undefined })}
          current={filter.project === undefined}
          label="Every project"
          search={{ ...filter, project: undefined }}
        />
        {projectsOf(entries, filter).map((project) => (
          <FilterOption
            count={countWith(entries, filter, { project })}
            current={filter.project === project}
            key={project}
            label={project}
            search={{ ...filter, project }}
          />
        ))}
      </Facet>
      {filtered ? (
        <div className="text-ui flex flex-col items-start gap-2 px-2">
          <AppLink className={LINK} to={frontPath({})}>
            Reset filters
          </AppLink>
        </div>
      ) : null}
    </nav>
  );
};

const TakeTheTour = () => (
  <AppLink className={LINK} to={TOUR_PATH}>
    Take the tour
  </AppLink>
);

const NoAsks = ({
  projects,
}: {
  readonly projects: readonly ProjectListing[] | undefined;
}) =>
  projects?.length === 0 ? (
    <EmptyState
      onward={
        <>
          <AppLink className={LINK} to={IMPORT_PATH}>
            Bring a project here
          </AppLink>
          <TakeTheTour />
        </>
      }
      title="No open asks, and no project yet."
    />
  ) : (
    <EmptyState onward={<TakeTheTour />} title="No open asks on any project." />
  );

interface Group {
  readonly project: ProjectName;
  readonly entries: readonly FrontPageEntry[];
  readonly items: readonly Arranged[];
  readonly states: ReadonlyMap<AskId, AskProgress>;
}

const rowIds = (groups: readonly Group[]) =>
  groups.flatMap(({ items }) =>
    items.map((item) =>
      item.kind === "ask" ? item.listing.ask : item.parent.ask
    )
  );

const ProjectGroup = ({
  group,
  listing,
  now,
  parents,
  selected,
  stamps,
}: {
  readonly group: Group;
  readonly listing: ProjectListing | undefined;
  readonly now: DateTime.Utc;
  readonly parents: readonly Ask[];
  readonly selected: string | undefined;
  readonly stamps: ReadonlySet<AskId>;
}) => {
  const { entries, items, project, states } = group;
  const takeable = new Map(entries.map((entry) => [entry.ask.ask, entry]));

  const row = (listingOf: FrontPageEntry["ask"], strip?: ReactNode) => (
    <AskRow
      key={listingOf.ask}
      listing={listingOf}
      now={now}
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
      under="bar"
    >
      {items.flatMap((item) => {
        if (item.kind === "ask") {
          return [row(item.listing)];
        }

        const parent = parents.find(
          (ask) => ask.project === project && ask.id === item.parent.ask
        );

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

export const FrontPageView = ({
  entries,
  events,
  filter,
  now,
  parents,
  projects,
  stampsOf,
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

  const { selected } = useRowSelection(rowIds(groups), "ask");

  return (
    <Workspace
      count={frontCount(shown)}
      crumbs={[{ label: "Asks" }]}
      status={
        <p className="text-want text-muted-foreground max-w-(--measure)">
          {EXPLAINER}
        </p>
      }
      title="Open asks"
      variant="board"
    >
      {entries.length === 0 ? (
        <NoAsks projects={projects} />
      ) : (
        <div
          className="columns:grid columns:grid-cols-[var(--column-filters)_minmax(0,1fr)] flex flex-col gap-8"
          data-board=""
        >
          <Filters entries={entries} filter={filter} />
          <div className="flex min-w-0 flex-col gap-6" data-board-list="">
            {shown.length === 0 ? (
              <EmptyState
                onward={
                  <AppLink className={LINK} to={frontPath({})}>
                    Show every open ask
                  </AppLink>
                }
                title="No open asks match this filter."
              />
            ) : (
              groups.map((group) => (
                <ProjectGroup
                  group={group}
                  key={group.project}
                  listing={projects?.find(
                    ({ project }) => project === group.project
                  )}
                  now={now}
                  parents={parents}
                  selected={selected}
                  stamps={stampsOf?.(group.project) ?? new Set()}
                />
              ))
            )}
          </div>
        </div>
      )}
    </Workspace>
  );
};
