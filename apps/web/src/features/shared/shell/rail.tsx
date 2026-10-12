import { Brand } from "@repo/brand";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import type { ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { useLocation } from "@tanstack/react-router";
import {
  BookOpen,
  Bot,
  CalendarCheck,
  ChevronDown,
  Folders,
  House,
  Keyboard,
  List,
  Menu,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../components/ui/button.tsx";
import { Skeleton } from "../../../components/ui/skeleton.tsx";
import { SessionSlot } from "../../auth/session-slot.tsx";
import { postureLabel, postureWord } from "../../project/posture-label.ts";
import { AppLink } from "../link.tsx";
import { POSTURE_MARKS } from "../mark-look.ts";
import { ASKS_PATH, docsPath, HOME_PATH } from "../paths.ts";
import { leadingProjects, PROJECTS_SHOWN } from "../project-order.ts";
import {
  useCurrentProject,
  useProjectList,
  useShell,
  useTodayCount,
} from "./context.ts";
import { RailSlotOutlet, useRailContent } from "./rail-slot.tsx";
import { projectSections, sectionOf } from "./sections.ts";

const RAIL_BASE =
  "text-ui text-foreground hover:bg-surface flex h-8 min-w-0 items-center gap-2.5 px-2 no-underline transition-colors duration-[120ms] focus-visible:outline-offset-[-2px] [&[aria-current]]:font-semibold [&[aria-current]>svg]:text-foreground";

export const RAIL_ROW = `${RAIL_BASE} [&[aria-current]]:bg-surface`;

const MARK = "text-muted-foreground size-4 shrink-0";

const SITE = [
  { icon: House, label: "Home", to: HOME_PATH },
  { icon: List, label: "Asks", to: ASKS_PATH },
  { icon: CalendarCheck, label: "Today", to: "/today" },
  { icon: BookOpen, label: "Docs", to: docsPath() },
  { icon: Bot, label: "For agents", to: "/agents" },
] as const satisfies readonly {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly to: string;
}[];

const EXACT = { exact: true, includeSearch: false } as const;

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

const TodayCount = () => useTodayCount() ?? null;

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

export const PostureMark = ({ posture }: { readonly posture: Posture }) => {
  const { icon: Icon, tone } = POSTURE_MARKS[posture];

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
      {postureWord(posture)}
      <span className="sr-only">: {postureLabel(posture)}</span>
    </span>
  );
};

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
 * The current one first, so the list arriving after the page moves nothing
 * above it.
 */
const Projects = () => {
  const current = useCurrentProject();
  const listed = useProjectList();
  const { open } = useShell();

  const listingOf = (project: string) =>
    listed?.find((listing) => listing.project === project);

  const others = (listed ?? []).filter(({ project }) => project !== current);
  const room = PROJECTS_SHOWN - (current === undefined ? 0 : 1);
  const leading = leadingProjects(others, room);

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
          leading.map((listing) => (
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
 * The colour comes from around the button: the kit merges classes, reads an
 * unknown `text-*` as a colour, and would drop the button's `text-ui` size.
 */
const Quiet = ({ children }: { readonly children: ReactNode }) => (
  <span className="text-muted-foreground flex shrink-0">{children}</span>
);

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

export const RailContent = (): ReactNode => (
  <div className="flex flex-col gap-2 px-2 py-2">
    <SiteSections />
    <Projects />
  </div>
);

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
