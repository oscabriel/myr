/**
 * The rail: where the reader is. Top to bottom, the wordmark; the site's
 * sections (Asks, Today, For agents), each a word beside its mark; the
 * projects, the current one first with its own sections under it; the
 * rail's slot on pages that fill it (the code pages' tree); and the session
 * with the Keys button at the foot.
 *
 * From the shell's width it is a column beside main; below it, the same
 * content opens as a sheet from the top bar's Menu (`RailContent`). The
 * current item is filled with the surface and set in ink at 600, never
 * coloured; the router marks a link to the page being read
 * `aria-current="page"`, and a section holding the page is marked
 * `aria-current="true"`.
 */
import { Brand } from "@repo/brand";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import type { ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { useLocation } from "@tanstack/react-router";
import {
  Bot,
  CalendarCheck,
  ChevronDown,
  Eye,
  Folders,
  Keyboard,
  List,
  LockKeyhole,
  LockKeyholeOpen,
  Menu,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../components/ui/button.tsx";
import { Skeleton } from "../../../components/ui/skeleton.tsx";
import { SessionSlot } from "../../auth/session-slot.tsx";
import { postureLabel } from "../../project/posture-label.ts";
import { AppLink } from "../link.tsx";
import {
  useCurrentProject,
  useProjectList,
  useShell,
  useTodayCount,
} from "./context.ts";
import { RailSlotOutlet, useRailContent } from "./rail-slot.tsx";
import { POSTURE_WORD, projectSections, sectionOf } from "./sections.ts";

/** A row of the rail, before the fill that marks the current one. */
const RAIL_BASE =
  "text-ui text-foreground hover:bg-surface flex h-8 min-w-0 items-center gap-2.5 px-2 no-underline transition-colors duration-[120ms] focus-visible:outline-offset-[-2px] [&[aria-current]]:font-semibold [&[aria-current]>svg]:text-foreground";

/** A row of the rail: a word (and its mark), 32 px, filled when current. */
export const RAIL_ROW = `${RAIL_BASE} [&[aria-current]]:bg-surface`;

/** A row's mark: 16 px at the marks' stroke, muted until the row is current. */
const MARK = "text-muted-foreground size-4 shrink-0";

/** At most this many projects in the rail; more open the switcher. */
const SHOWN = 8;

const SITE = [
  { icon: List, label: "Asks", to: "/" },
  { icon: CalendarCheck, label: "Today", to: "/today" },
  { icon: Bot, label: "For agents", to: "/agents" },
] as const satisfies readonly {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly to: string;
}[];

/** Only the page itself is current; its search (a filter, a selection) does not count. */
const EXACT = { exact: true, includeSearch: false } as const;

/** A count of things at a rail row's end, in tabular figures, with what it counts for a screen reader. */
export const RailCount = ({
  count,
  of,
}: {
  readonly count: number;
  readonly of: string;
}) => (
  <span className="text-muted-foreground ml-auto font-normal tabular-nums">
    {count}
    <span className="sr-only"> {of}</span>
  </span>
);

/** Today's count, as the root route read it. */
const TodayCount = () => useTodayCount() ?? null;

/** The wordmark, home to the front page. */
export const Wordmark = ({
  className = "",
}: {
  readonly className?: string;
}) => (
  <AppLink
    activeOptions={EXACT}
    className={`text-want text-foreground font-semibold tracking-[-0.015em] no-underline ${className}`}
    to="/"
  >
    {Brand.name}
  </AppLink>
);

/** Asks, Today and For agents. */
const SiteSections = () => (
  <ul className="flex flex-col gap-px">
    {SITE.map(({ icon: Icon, label, to }) => (
      <li key={to}>
        <AppLink activeOptions={EXACT} className={RAIL_ROW} to={to}>
          <Icon aria-hidden="true" className={MARK} strokeWidth={1.75} />
          {label}
          {to === "/today" ? <TodayCount /> : null}
        </AppLink>
      </li>
    ))}
  </ul>
);

/** A posture's mark: a lock in the sealed role when something is kept sealed. */
const POSTURE_MARK = {
  open: { icon: LockKeyholeOpen, tone: "text-muted-foreground" },
  openCore: { icon: LockKeyhole, tone: "text-sealed" },
  openOnSchedule: { icon: LockKeyhole, tone: "text-sealed" },
  openWithSealedEvidence: { icon: LockKeyhole, tone: "text-sealed" },
  sourceAvailable: { icon: Eye, tone: "text-muted-foreground" },
} as const satisfies Record<
  Posture,
  { readonly icon: LucideIcon; readonly tone: string }
>;

/** A project's posture at its row's end: the mark in its role, a short word muted, the full label as its title. */
export const PostureMark = ({ posture }: { readonly posture: Posture }) => {
  const { icon: Icon, tone } = POSTURE_MARK[posture];

  return (
    <span
      className="text-label text-muted-foreground ml-auto flex shrink-0 items-center gap-1 font-normal"
      data-posture={posture}
      title={postureLabel(posture)}
    >
      <Icon
        aria-hidden="true"
        className={`size-3.5 ${tone}`}
        strokeWidth={1.75}
      />
      {POSTURE_WORD[posture]}
      <span className="sr-only">: {postureLabel(posture)}</span>
    </span>
  );
};

/**
 * A project's row: its name, and its posture once the list has it. The
 * current project's is in ink at 600 but unfilled, so the page being read
 * (a section under it) is the one filled row.
 */
const ProjectRow = ({
  current,
  listing,
  project,
}: {
  readonly current: boolean;
  readonly listing: ProjectListing | undefined;
  readonly project: string;
}) => (
  <AppLink
    activeOptions={EXACT}
    aria-current={current ? "true" : undefined}
    className={RAIL_BASE}
    data-project={project}
    to={`/${project}`}
  >
    <span className="min-w-0 truncate">{project}</span>
    {listing === undefined ? null : <PostureMark posture={listing.posture} />}
  </AppLink>
);

/** The current project's sections, indented under it, the open asks counted beside Asks. */
export const ProjectSectionList = ({
  openAsks,
  project,
}: {
  readonly openAsks: number | undefined;
  readonly project: ProjectName;
}) => {
  const section = useLocation({
    select: ({ pathname }) => sectionOf(pathname),
  });

  return (
    <ul
      aria-label={`${project}'s sections`}
      className="border-rule ml-4 flex flex-col gap-px border-l py-0.5 pl-1.5"
    >
      {projectSections(project).map(({ label, tab, to }) => (
        <li key={tab}>
          <AppLink
            activeOptions={EXACT}
            aria-current={section === tab ? "true" : undefined}
            className={RAIL_ROW}
            to={to}
          >
            {label}
            {tab === "overview" && openAsks !== undefined ? (
              <RailCount count={openAsks} of="open" />
            ) : null}
          </AppLink>
        </li>
      ))}
    </ul>
  );
};

/** The list's place while it is read: three rows of the rail's height. */
const PLACEHOLDERS = ["w-24", "w-20", "w-28"] as const;

const PlaceholderRows = () => (
  <li aria-hidden="true" className="flex flex-col gap-px">
    {PLACEHOLDERS.map((width) => (
      <span className="flex h-8 items-center px-2" key={width}>
        <Skeleton className={`h-2.5 ${width}`} />
      </span>
    ))}
  </li>
);

/**
 * The projects: the current one first, its sections under it, so the list
 * arriving after the page moves nothing above it; then the others, up to
 * eight in all, and the switcher for the rest.
 */
const Projects = () => {
  const current = useCurrentProject();
  const listed = useProjectList();
  const { open } = useShell();

  const listingOf = (project: string) =>
    listed?.find((listing) => listing.project === project);

  const others = (listed ?? []).filter(({ project }) => project !== current);
  const room = SHOWN - (current === undefined ? 0 : 1);

  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-label text-muted-foreground px-2 pt-4 pb-1">
        Projects
      </h2>
      <ul className="flex flex-col gap-px">
        {current === undefined ? null : (
          <li>
            <ProjectRow
              current
              listing={listingOf(current)}
              project={current}
            />
            <ProjectSectionList
              openAsks={listingOf(current)?.openAsks}
              project={current}
            />
          </li>
        )}
        {listed === undefined ? (
          <PlaceholderRows />
        ) : (
          others.slice(0, room).map((listing) => (
            <li key={listing.project}>
              <ProjectRow
                current={false}
                listing={listing}
                project={listing.project}
              />
            </li>
          ))
        )}
        {listed !== undefined && others.length > room ? (
          <li>
            <button
              className={`${RAIL_ROW} w-full cursor-pointer`}
              onClick={() => {
                open("projects");
              }}
              type="button"
            >
              <Folders aria-hidden="true" className={MARK} strokeWidth={1.75} />
              All projects
              <RailCount count={listed.length} of="projects" />
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
};

/**
 * A ghost button set in muted text, ink on hover. The colour comes from
 * around the button, not through its `className`: the kit merges classes,
 * reads an unknown `text-*` as a colour, and would drop the button's
 * `text-ui` size for a colour given there.
 */
const Quiet = ({ children }: { readonly children: ReactNode }) => (
  <span className="text-muted-foreground flex shrink-0">{children}</span>
);

/** The rail's foot: the session, and the Keys button that opens the `?` dialog. */
export const RailFoot = () => {
  const { open } = useShell();

  return (
    <div className="border-rule flex min-h-12 shrink-0 items-center justify-between gap-2 border-t py-1.5 pr-1.5 pl-3">
      <SessionSlot layout="rail" />
      <Quiet>
        <Button
          onClick={() => {
            open("keys");
          }}
          size="sm"
          variant="ghost"
        >
          <Keyboard aria-hidden="true" strokeWidth={1.75} />
          Keys
        </Button>
      </Quiet>
    </div>
  );
};

/** The rail's sections and projects: the column's middle, and the Menu sheet's body. */
export const RailContent = (): ReactNode => (
  <div className="flex flex-col gap-2 px-2 py-2">
    <SiteSections />
    <Projects />
  </div>
);

/**
 * The project's line in the code pages' rail: its name and the section
 * being read, opening to the project's sections, so the tree below gets
 * the height.
 */
const ProjectLine = ({ project }: { readonly project: ProjectName }) => {
  const listed = useProjectList();

  const section = useLocation({
    select: ({ pathname }) => sectionOf(pathname),
  });

  const label = projectSections(project).find(
    ({ tab }) => tab === section
  )?.label;

  return (
    <details className="group border-rule border-t">
      <summary className="text-ui hover:bg-surface flex h-10 cursor-pointer list-none items-center gap-2 px-4 transition-colors duration-[120ms] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate font-semibold">{project}</span>
        {label === undefined ? null : (
          <span className="text-muted-foreground truncate">{label}</span>
        )}
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground ml-auto size-4 shrink-0 transition-transform duration-150 group-open:rotate-180"
          strokeWidth={1.75}
        />
      </summary>
      <div className="px-2 pb-2">
        <ProjectSectionList
          openAsks={
            listed?.find((listing) => listing.project === project)?.openAsks
          }
          project={project}
        />
      </div>
    </details>
  );
};

/**
 * The rail as a column, from the shell's width. On a page that fills the
 * slot (the code pages) it gives the slot the height: the site's sections
 * and the projects fold into the wordmark row's Menu, and the project's
 * sections into its line.
 */
export const Rail = () => {
  const slotted = useRailContent() !== undefined;
  const project = useCurrentProject();
  const { open } = useShell();

  return (
    <nav
      aria-label="Site"
      className="border-rule bg-background shell:flex hidden h-dvh w-60 shrink-0 flex-col border-r"
    >
      <div className="border-rule flex h-11 shrink-0 items-center justify-between gap-2 border-b pr-1.5 pl-4">
        <Wordmark />
        {slotted ? (
          <Quiet>
            <Button
              onClick={() => {
                open("menu");
              }}
              size="sm"
              variant="ghost"
            >
              <Menu aria-hidden="true" strokeWidth={1.75} />
              Menu
            </Button>
          </Quiet>
        ) : null}
      </div>
      {slotted ? (
        <>
          {project === undefined ? null : <ProjectLine project={project} />}
          <RailSlotOutlet />
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <RailContent />
        </div>
      )}
      <RailFoot />
    </nav>
  );
};
