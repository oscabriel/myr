/**
 * A project's one header (ADR 0041): its name, posture, description, facts
 * and three actions, then its eight tabs. Every page of the project draws it
 * the same; only the current tab moves.
 */
import { Brand } from "@repo/brand";
import type { Handle, ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
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

/** A source path's owner is everything before its last slash (`github.com/pallets`). */
const ownerAndName = (project: ProjectName) => {
  const at = project.lastIndexOf("/");

  return { name: project.slice(at + 1), owner: project.slice(0, at) };
};

export const cloneCommand = (platformUrl: string, project: ProjectName) =>
  `git clone ${platformUrl}/${project}.git`;

/**
 * Clone with git, or claim an ask to answer it: a claim brings its own fork.
 * The Clone popover and Overview's clone card say the same thing.
 */
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
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-ui">Or claim an ask to answer it</p>
      <CommandLine command={`${Brand.cli} claim <ask> --project ${project}`} />
    </div>
    <p className="text-ui text-muted-foreground">
      A claim comes with a fork to push your answer to, so there is nothing to
      fork by hand.
    </p>
  </div>
);

/**
 * The CLI has no command that follows a project, so Watch says what already
 * follows it (this page, and the events) and how to read your own part in it.
 */
export const WatchSteps = ({ project }: { readonly project: ProjectName }) => (
  <div className="flex min-w-0 flex-col gap-3" data-steps="watch">
    <p className="text-ui">
      This page follows the project as it happens: claims, pushes, verdicts
      and landings arrive without a reload.
    </p>
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-ui">Your own claims and answers here</p>
      <CommandLine command={`${Brand.cli} status --project ${project}`} />
    </div>
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
      <WatchSteps project={project} />
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
          hash="open-asks"
          to={`/${project}`}
        >
          Take an open ask
        </MenuLink>
        <MenuLink
          detail="A change you want, with a check the agent can draft"
          to={`/${project}/proposals/new`}
        >
          Propose an ask
        </MenuLink>
        <MenuLink
          detail="What lands here and who decides"
          to={`/${project}/people`}
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
  "text-ui text-muted-foreground hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground -mb-px flex h-(--tabs) shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 whitespace-nowrap no-underline transition-colors duration-[120ms] first:pl-0 focus-visible:outline-offset-[-2px] aria-[current=page]:font-medium";

/**
 * Text tabs, the current one ink with the 2 px underline. Each matches the
 * router's own path and hash exactly, so the router never marks a second tab.
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
    className={`border-rule bg-background sticky top-(--top-bar) z-20 border-b ${GUTTER}`}
    data-project-tabs=""
  >
    <div className="flex [scrollbar-width:none] overflow-x-auto overscroll-x-contain">
      {projectSections(project).map(({ hash, label, tab, to }) => (
        <AppLink
          activeOptions={{ exact: true, includeHash: true, includeSearch: false }}
          aria-current={tab === current ? "page" : undefined}
          className={TAB}
          key={tab}
          to={to}
          {...(hash === undefined ? {} : { hash })}
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
    // No box of its own, so the tabs stick for the whole page, not only past the header.
    <div className="contents" data-project-header="">
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
