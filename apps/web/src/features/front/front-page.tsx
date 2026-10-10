/**
 * The front page: the open asks of every project, the ones the viewer may
 * take first, each other one with the reason it is not theirs to take; a
 * filter by kind and by who an ask is held for; then every project with its
 * posture. Props in, markup out: the route reads the entries and projects
 * (`src/client/front.ts`) and the filter from the address, and hands them
 * here.
 *
 * The filter is a plain link (`/?kind=bug`), so a filtered list is an
 * address a newcomer can share.
 */
import { Brand } from "@repo/brand";
import { Reserve } from "@repo/protocol/domain/ask";
import type {
  FrontPageEntry,
  ProjectListing,
} from "@repo/protocol/domain/front-page";
import type { KindName } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import type { ReactNode } from "react";

import { AskFields, AskStanding } from "../project/asks.tsx";
import { postureLabel } from "../project/posture-label.ts";
import { ID, SECTION } from "../shared/classes.ts";
import { CommandLine } from "../shared/command.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { PageShell } from "../shared/layout.tsx";
import { askPath, projectPath } from "../shared/paths.ts";
import { PostureBadge } from "../shared/posture.tsx";
import { When } from "../shared/time.tsx";
import { filterEntries, frontPath } from "./filter.ts";
import type { FrontFilter } from "./filter.ts";

const Entry = ({ entry }: { readonly entry: FrontPageEntry }) => {
  const { ask, posture, project, takeable } = entry;

  return (
    <li
      className="border-rule flex flex-col gap-2 border-t py-4"
      data-ask={ask.ask}
      data-project={project}
      data-takeable={takeable}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
          <a
            className="decoration-rule font-semibold underline hover:decoration-current"
            href={projectPath(project)}
          >
            {project}
          </a>
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <a
            className={`${ID} decoration-rule underline hover:decoration-current`}
            href={askPath(project, ask.ask)}
          >
            {ask.ask}
          </a>
        </p>
        <AskStanding listing={ask} project={project} takeable={takeable} />
      </div>
      <p className="max-w-[70ch] text-base">{ask.want}</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <AskFields listing={ask} />
        <PostureBadge label={postureLabel(posture)} posture={posture} />
      </div>
      {takeable ? (
        <CommandLine
          command={`${Brand.cli} claim ${ask.ask} --project ${project}`}
        />
      ) : null}
    </li>
  );
};

/** One filter option: a link, the current one marked as the page. */
const FilterOption = ({
  current,
  href,
  label,
}: {
  readonly current: boolean;
  readonly href: string;
  readonly label: string;
}) => (
  <li>
    <a
      aria-current={current ? "page" : undefined}
      className="text-muted-foreground hover:text-foreground aria-[current=page]:border-rule-strong aria-[current=page]:text-foreground inline-flex min-h-8 items-center border-b-2 border-transparent text-sm no-underline aria-[current=page]:font-medium"
      href={href}
    >
      {label}
    </a>
  </li>
);

const FilterRow = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) => (
  <div className="flex flex-col gap-x-4 sm:flex-row sm:items-baseline">
    <span className="text-muted-foreground w-20 shrink-0 text-xs font-medium">
      {label}
    </span>
    <ul className="flex flex-wrap gap-x-4">{children}</ul>
  </div>
);

const Filters = ({
  filter,
  kinds,
}: {
  readonly filter: FrontFilter;
  readonly kinds: readonly KindName[];
}) => (
  <nav
    aria-label="Filter the asks"
    className="border-rule flex flex-col gap-2 border-y py-3"
  >
    <FilterRow label="Kind">
      <FilterOption
        current={filter.kind === undefined}
        href={frontPath({ ...filter, kind: undefined })}
        label="All kinds"
      />
      {kinds.map((kind) => (
        <FilterOption
          current={filter.kind === kind}
          href={frontPath({ ...filter, kind })}
          key={kind}
          label={kind}
        />
      ))}
    </FilterRow>
    <FilterRow label="Reserved">
      <FilterOption
        current={filter.reserved === undefined}
        href={frontPath({ ...filter, reserved: undefined })}
        label="All asks"
      />
      {Reserve.literals.map((reserved) => (
        <FilterOption
          current={filter.reserved === reserved}
          href={frontPath({ ...filter, reserved })}
          key={reserved}
          label={
            reserved === "newcomers"
              ? "For newcomers"
              : "For people, not agents"
          }
        />
      ))}
    </FilterRow>
  </nav>
);

const Projects = ({
  now,
  projects,
}: {
  readonly now: DateTime.Utc;
  readonly projects: readonly ProjectListing[];
}) => (
  <section aria-labelledby="projects" className="flex flex-col gap-3">
    <h2 className={SECTION} id="projects">
      Projects
    </h2>
    <ul className="border-rule flex flex-col border-y">
      {projects.map((listing) => (
        <li
          className="border-rule flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t py-3 first:border-t-0"
          key={listing.project}
        >
          <a
            className="decoration-rule font-semibold underline hover:decoration-current"
            href={projectPath(listing.project)}
          >
            {listing.project}
          </a>
          <PostureBadge
            label={postureLabel(listing.posture)}
            posture={listing.posture}
          />
          <span className="text-muted-foreground text-sm">
            {listing.openAsks} open {listing.openAsks === 1 ? "ask" : "asks"}
            {listing.landedAt === undefined ? null : (
              <>
                {" · last landed "}
                <When at={listing.landedAt} now={now} />
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  </section>
);

/** The kinds on the page, and the one filtered to, each once, by name. */
const kindsOf = (entries: readonly FrontPageEntry[], filter: FrontFilter) =>
  [
    ...new Set([
      ...entries.map(({ ask }) => ask.kind),
      ...(filter.kind === undefined ? [] : [filter.kind]),
    ]),
  ].toSorted();

/**
 * The front page with no open ask: with no project yet, the command that
 * brings one; with projects, the command that opens an ask.
 */
const NoAsks = ({
  projects,
}: {
  readonly projects: readonly ProjectListing[];
}) =>
  projects.length === 0 ? (
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

const countOf = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export const FrontPageView = ({
  entries,
  filter,
  now,
  projects,
}: {
  readonly entries: readonly FrontPageEntry[];
  readonly filter: FrontFilter;
  readonly now: DateTime.Utc;
  readonly projects: readonly ProjectListing[];
}) => {
  const shown = filterEntries(entries, filter);
  const takeable = shown.filter((entry) => entry.takeable).length;

  return (
    <PageShell title="Open asks">
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground max-w-[70ch]">
          Each ask is one change a project wants, with a check that fails on its
          main today. Claim one, make the check pass, and push: the gate lands
          it.
        </p>
        {entries.length === 0 ? null : (
          <Filters filter={filter} kinds={kindsOf(entries, filter)} />
        )}
      </div>
      <section aria-label="Asks" className="flex flex-col gap-3">
        {entries.length === 0 ? <NoAsks projects={projects} /> : null}
        {entries.length > 0 && shown.length === 0 ? (
          <div className="flex flex-col gap-2">
            <EmptyState title="No open asks match this filter." />
            <a
              className="decoration-rule self-start text-sm underline hover:decoration-current"
              href={frontPath({})}
            >
              Show every open ask
            </a>
          </div>
        ) : null}
        {shown.length === 0 ? null : (
          <>
            <p className="text-muted-foreground text-sm">
              {countOf(shown.length, "open ask", "open asks")}
              {", "}
              {takeable} open to take
            </p>
            <ol className="border-rule flex flex-col border-b">
              {shown.map((entry) => (
                <Entry
                  entry={entry}
                  key={`${entry.project}/${entry.ask.ask}`}
                />
              ))}
            </ol>
          </>
        )}
      </section>
      {projects.length === 0 ? null : (
        <Projects now={now} projects={projects} />
      )}
    </PageShell>
  );
};
