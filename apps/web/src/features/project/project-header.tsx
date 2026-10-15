/**
 * A project's one header (ADR 0041): its name, posture, description, facts
 * and three actions, then its nine tabs. Every page of the project draws it
 * the same; only the current tab moves.
 */
import type { RefsView, TagName } from "@repo/protocol/domain/code";
import type { Handle, ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { Option } from "effect";
import type { DateTime } from "effect";
import { ChevronDown, Tag } from "lucide-react";
import type { ReactNode } from "react";

import { buttonVariants } from "../../components/ui/button.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.tsx";
import { plural } from "../front/facts.tsx";
import { LINK } from "../shared/classes.ts";
import { CommandLine } from "../shared/command.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { PostureBadge } from "../shared/posture.tsx";
import { GUTTER } from "../shared/shell/gutter.ts";
import { projectSections } from "../shared/shell/sections.ts";
import type { ProjectTab } from "../shared/shell/sections.ts";
import { When } from "../shared/time.tsx";
import { postureWord } from "./posture-label.ts";

export interface ProjectHeaderFacts {
  readonly project: ProjectName;
  readonly now: DateTime.Utc;
  readonly deciders?: readonly Handle[] | undefined;
  readonly landedAt?: DateTime.Utc | undefined;
  readonly latestTag?: string | undefined;
  readonly lede?: string | undefined;
  readonly open?:
    | { readonly asks: number; readonly takeable: number }
    | undefined;
  readonly posture?:
    | { readonly label: string; readonly posture: Posture }
    | undefined;
}

/**
 * Newest by name, not by date: a tag carries only its name and commit. Its
 * numbers sort as numbers (`v0.10.0` is newer than `v0.9.0`), but a
 * pre-release such as `v2.0.0-beta` reads as newer than `v2.0.0`, and a tag
 * of no version shape wins or loses by its letters. Once a tag is read with
 * its time, the header can say the newest in time.
 */
const byNewest = (a: TagName, b: TagName) =>
  b.localeCompare(a, "en", { numeric: true });

/** The header's newest tag once the refs are read; none while they are not, or when there is none. */
export const newestTag = (refs: Option.Option<RefsView>) =>
  Option.match(refs, {
    onNone: () => ({}),
    onSome: ({ tags }) => {
      const [latestTag] = tags.map((tag) => tag.name).toSorted(byNewest);

      return latestTag === undefined ? {} : { latestTag };
    },
  });

/** A source path's owner is everything before its last slash (`github.com/pallets`). */
const ownerAndName = (project: ProjectName) => {
  const at = project.lastIndexOf("/");

  return { name: project.slice(at + 1), owner: project.slice(0, at) };
};

export const cloneCommand = (platformUrl: string, project: ProjectName) =>
  `git clone ${platformUrl}/${project}.git`;

/** The Clone popover and Overview's clone card say the same thing. */
export const CloneSteps = ({
  platformUrl,
  project,
}: {
  readonly platformUrl: string;
  readonly project: ProjectName;
}) => (
  <div className="flex min-w-0 flex-col gap-3" data-steps="clone">
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-ui">Clone it with git</p>
      <CommandLine command={cloneCommand(platformUrl, project)} />
    </div>
  </div>
);

/** Watch says what already follows the project: this page, and the events. */
export const WatchSteps = () => (
  <div className="flex min-w-0 flex-col gap-3" data-steps="watch">
    <p className="text-ui">
      This page follows the project as it happens: claims, pushes, verdicts and
      landings arrive without a reload.
    </p>
    <AppLink className={`text-ui ${LINK} self-start`} to="/docs/events">
      Follow its events from a program
    </AppLink>
  </div>
);

const ACTION = buttonVariants({ variant: "outline" });

const Action = ({
  children,
  label,
  primary = false,
  wide = false,
}: {
  readonly label: string;
  readonly primary?: boolean;
  readonly wide?: boolean;
  readonly children: ReactNode;
}) => (
  <Popover>
    <PopoverTrigger
      className={primary ? buttonVariants({ variant: "default" }) : ACTION}
      data-action={label.toLowerCase()}
    >
      {label}
      <ChevronDown aria-hidden="true" strokeWidth={1.75} />
    </PopoverTrigger>
    <PopoverContent
      align="end"
      className={`${wide ? "w-[min(28rem,calc(100vw-2rem))]" : "w-[min(20rem,calc(100vw-2rem))]"} gap-3 p-3`}
    >
      {children}
    </PopoverContent>
  </Popover>
);

const MenuLink = ({
  children,
  detail,
  hash,
  to,
}: {
  readonly to: string;
  readonly hash?: string;
  readonly detail: string;
  readonly children: string;
}) => (
  <AppLink
    className="hover:bg-surface -mx-1 flex flex-col gap-0.5 px-1 py-1.5 no-underline"
    to={to}
    {...(hash === undefined ? {} : { hash })}
  >
    <span className="text-ui font-medium">{children}</span>
    <span className="text-label text-muted-foreground">{detail}</span>
  </AppLink>
);

const Actions = ({
  open,
  platformUrl,
  project,
}: {
  readonly open: ProjectHeaderFacts["open"];
  readonly platformUrl: string;
  readonly project: ProjectName;
}) => (
  <div className="flex shrink-0 flex-wrap items-center gap-2">
    <Action label="Watch">
      <WatchSteps />
    </Action>
    <Action label="Clone" wide>
      <CloneSteps platformUrl={platformUrl} project={project} />
    </Action>
    <Action label="Contribute" primary>
      <nav aria-label="Contribute" className="flex flex-col">
        <MenuLink
          detail={
            open === undefined
              ? "Its open asks"
              : `${plural(open.takeable, "ask", "asks")} open to take now`
          }
          to={`/${project}/asks`}
        >
          Take an open ask
        </MenuLink>
        <MenuLink
          detail="A change you want, talked over before it is an ask"
          to={`/${project}/discussions`}
        >
          Start a discussion
        </MenuLink>
        <MenuLink
          detail="What lands here and who decides"
          to={`/${project}/policy`}
        >
          Read the policy
        </MenuLink>
      </nav>
    </Action>
  </div>
);

const Facts = ({ facts }: { readonly facts: ProjectHeaderFacts }) => {
  const { deciders = [], landedAt, latestTag, now, open } = facts;

  const parts = [
    open === undefined ? undefined : (
      <span className="tabular-nums" key="asks">
        {plural(open.asks, "open ask", "open asks")}
      </span>
    ),
    landedAt === undefined ? undefined : (
      <span key="landed">
        Landed <When at={landedAt} now={now} />
      </span>
    ),
    latestTag === undefined ? undefined : (
      <span className="inline-flex items-center gap-1.5" key="tag">
        <Tag aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
        <code className="text-mono font-mono">{latestTag}</code>
      </span>
    ),
    deciders.length === 0 ? undefined : (
      <span key="deciders">
        Decided by{" "}
        {deciders.map((handle, at) => (
          <span key={handle}>
            {at === 0 ? null : ", "}
            <HandleLink handle={handle} />
          </span>
        ))}
      </span>
    ),
  ].filter((part) => part !== undefined);

  return parts.length === 0 ? null : (
    <p
      className="text-ui text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1"
      data-project-facts=""
    >
      {parts}
    </p>
  );
};

const TAB =
  "text-ui text-muted-foreground hover:text-foreground data-current:border-foreground data-current:text-foreground -mb-px flex h-(--tabs) shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 whitespace-nowrap no-underline transition-colors duration-[120ms] first:pl-0 focus-visible:outline-offset-[-2px] data-current:font-medium";

/** The router marks a link to the page being read, by its path. */
const ACTIVE = { exact: true, includeSearch: false } as const;

/**
 * Text tabs, the current one ink with the 2 px underline. The current tab
 * follows the page's path alone, so the server and the browser draw the same
 * mark.
 */
export const ProjectTabs = ({
  current,
  open,
  project,
}: {
  readonly current: ProjectTab | undefined;
  readonly open?: ProjectHeaderFacts["open"];
  readonly project: ProjectName;
}) => (
  <nav
    aria-label={`${project} tabs`}
    className={`border-rule bg-background border-b ${GUTTER}`}
    data-project-tabs=""
  >
    {/* Below `tablet` the strip scrolls with its scrollbar hidden, so a fade at its right edge is the cue that more tabs lie off screen. */}
    <div
      className="tablet:after:hidden after:from-background relative after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-10 after:bg-linear-to-l after:to-transparent after:content-['']"
      data-tabs-fade=""
    >
      <div className="flex [scrollbar-width:none] overflow-x-auto overscroll-x-contain">
        {projectSections(project).map(({ label, search, tab, to }) => (
          <AppLink
            activeOptions={ACTIVE}
            aria-current={tab === current ? "page" : undefined}
            className={TAB}
            data-current={tab === current ? "" : undefined}
            key={tab}
            to={to}
            {...(search === undefined ? {} : { search })}
          >
            {label}
            {tab === "asks" && open !== undefined ? (
              <span className="text-label text-muted-foreground tabular-nums">
                {open.asks}
              </span>
            ) : null}
          </AppLink>
        ))}
      </div>
    </div>
  </nav>
);

export const ProjectHeader = ({
  current,
  header,
  platformUrl,
}: {
  readonly header: ProjectHeaderFacts;
  readonly current: ProjectTab | undefined;
  readonly platformUrl: string;
}) => {
  const { lede, open, posture, project } = header;
  const { name, owner } = ownerAndName(project);
  // Overview's title is the project; every other page titles its own subject.
  const Name = current === "overview" ? "h1" : "p";

  return (
    // The project's frame sticks the header and its tabs under the top bar together.
    <div data-project-header="">
      <div
        className={`nav:flex-row nav:items-start nav:justify-between flex flex-col gap-4 pt-6 pb-5 ${GUTTER}`}
      >
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Name className="text-headline min-w-0 break-words">
              <AppLink className="no-underline" to={`/${project}`}>
                <span className="text-muted-foreground font-normal">
                  {owner} /
                </span>{" "}
                {name}
              </AppLink>
            </Name>
            {posture === undefined ? null : (
              <PostureBadge
                label={postureWord(posture.posture)}
                posture={posture.posture}
                title={posture.label}
              />
            )}
          </div>
          {lede === undefined ? null : (
            <p className="text-want max-w-(--measure)">{lede}</p>
          )}
          <Facts facts={header} />
        </div>
        <Actions open={open} platformUrl={platformUrl} project={project} />
      </div>
      <ProjectTabs current={current} open={open} project={project} />
    </div>
  );
};
