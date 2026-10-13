/**
 * The Code tab's own bar, under the project's header (ADR 0041): Files or
 * Commits, the ref switcher, the revision's head commit, Go to file and
 * Clone. Below `columns` it also opens the file tree as a sheet. It reads
 * where it is from the path, and the head commit from the page's own read.
 */
import { CommitView } from "@repo/protocol/domain/code";
import { ProjectName } from "@repo/protocol/ids";
import { useLocation, useMatches, useParams } from "@tanstack/react-router";
import type { DateTime } from "effect";
import { Option, Schema } from "effect";
import { ChevronDown } from "lucide-react";
import { useMemo } from "react";
import type { ComponentType } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { cloneCommand } from "../project/project-header.tsx";
import { CommandLine } from "../shared/command.tsx";
import { AppLink } from "../shared/link.tsx";
import { GUTTER } from "../shared/shell/gutter.ts";
import { When } from "../shared/time.tsx";
import { codeAddressOf, codeViewOf } from "./code-address.ts";
import type { CodeAddress } from "./code-address.ts";
import { SEGMENT } from "./file-header.tsx";
import { GoToFile } from "./go-to-file.tsx";
import type { FileFinder } from "./go-to-file.tsx";
import {
  blobHref,
  commitHref,
  commitsHref,
  shortSha,
  treeHref,
  whyHref,
} from "./paths.ts";
import { RefSwitcher } from "./ref-switcher.tsx";
import type { RefChoicesReader } from "./ref-switcher.tsx";
import { isForkRev, pinnedRev, revLabel } from "./rev.ts";

const isProject = Schema.is(ProjectName);

/** What a code page's loader carries for the bar: the revision's head commit and the time it was read. */
const HeadData = Schema.Struct({
  head: Schema.optionalKey(CommitView),
  now: Schema.optionalKey(Schema.DateTimeUtcFromString),
});

const decodeHead = Schema.decodeUnknownOption(HeadData);

const useHead = () => {
  const data: unknown = useMatches({
    select: (matches) => matches.at(-1)?.loaderData,
  });

  return useMemo(
    () =>
      Option.getOrUndefined(
        Option.flatMap(decodeHead(data), ({ head, now }) =>
          head === undefined || now === undefined
            ? Option.none()
            : Option.some({ head, now })
        )
      ),
    [data]
  );
};

/** The same page at another revision; the refs list and a commit open the revision's tree. */
const atRev =
  (project: ProjectName, { page, path }: CodeAddress) =>
  (rev: string) => {
    if (page === "commits" || page === "commit") {
      return commitsHref(project, rev);
    }

    if (path === undefined || page === "tree" || page === "refs") {
      return treeHref(project, rev, page === "tree" ? path : undefined);
    }

    return (page === "why" ? whyHref : blobHref)(project, rev, path);
  };

const ViewToggle = ({
  address,
  project,
}: {
  readonly address: CodeAddress;
  readonly project: ProjectName;
}) => {
  const view = codeViewOf(address.page);

  return (
    <nav
      aria-label="Files or commits"
      className="border-input flex shrink-0 border"
    >
      <AppLink
        aria-current={view === "files" ? "page" : undefined}
        className={SEGMENT}
        to={treeHref(project, address.rev)}
      >
        Files
      </AppLink>
      <AppLink
        aria-current={view === "commits" ? "page" : undefined}
        className={SEGMENT}
        to={commitsHref(project, address.rev)}
      >
        Commits
      </AppLink>
    </nav>
  );
};

const HeadCommit = ({
  head,
  now,
  project,
  rev,
}: {
  readonly head: CommitView;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  readonly rev: string;
}) => (
  <p
    className="text-ui text-muted-foreground tablet:flex hidden min-w-0 flex-1 items-center gap-2"
    data-head-commit={head.sha}
  >
    <AppLink
      className="text-mono text-foreground shrink-0 font-mono no-underline hover:underline"
      title={head.sha}
      to={commitHref(project, pinnedRev(rev, head.sha))}
    >
      {shortSha(head.sha)}
    </AppLink>
    <AppLink
      className="text-foreground min-w-0 truncate no-underline hover:underline"
      title={head.subject}
      to={commitHref(project, pinnedRev(rev, head.sha))}
    >
      {head.subject === "" ? "(no subject)" : head.subject}
    </AppLink>
    <span className="diffsplit:inline hidden shrink-0 whitespace-nowrap">
      {head.author.name} · <When at={head.committer.at} now={now} />
    </span>
  </p>
);

/** A revision as one shell word: quoted unless it holds only a tag's or a SHA's usual characters. */
const shellWord = (rev: string) =>
  /^[\w./@+-]+$/u.test(rev) ? rev : `'${rev.replaceAll("'", `'\\''`)}'`;

/** After a clone, the command that moves to a tag or a commit. */
export const checkoutCommand = (rev: string) =>
  `git checkout ${shellWord(rev)}`;

const CloneHere = ({
  platformUrl,
  project,
  rev,
}: {
  readonly platformUrl: string;
  readonly project: ProjectName;
  readonly rev: string;
}) => (
  <Popover>
    <PopoverTrigger
      aria-label={`Clone, at ${revLabel(rev)}`}
      className={buttonVariants({ size: "sm", variant: "outline" })}
      data-action="clone-here"
    >
      Clone
      <ChevronDown aria-hidden="true" strokeWidth={1.75} />
    </PopoverTrigger>
    <PopoverContent
      align="end"
      className="w-[min(28rem,calc(100vw-2rem))] gap-3 p-3"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-ui">Clone it with git</p>
        <CommandLine command={cloneCommand(platformUrl, project)} />
      </div>
      {rev === "main" || isForkRev(rev) ? null : (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-ui">
            Then check out{" "}
            <span className="text-mono font-mono">{revLabel(rev)}</span>
          </p>
          <CommandLine command={checkoutCommand(rev)} />
        </div>
      )}
    </PopoverContent>
  </Popover>
);

/**
 * What reads the platform comes from the page's route: the refs list, the
 * finder's paths and the Files sheet's tree. The bar itself reads nothing.
 */
export interface CodeBarReads {
  readonly Choices: RefChoicesReader;
  readonly Files: ComponentType<{ readonly commit: boolean }>;
  readonly Finder: FileFinder | undefined;
}

export const CodeBar = ({
  platformUrl,
  reads: { Choices, Files, Finder },
}: {
  readonly platformUrl: string;
  readonly reads: CodeBarReads;
}) => {
  const params = useParams({ strict: false });
  const pathname = useLocation({ select: (location) => location.pathname });
  const head = useHead();

  const address = useMemo(
    () => Option.getOrUndefined(codeAddressOf(pathname)),
    [pathname]
  );

  const project = isProject(params.project) ? params.project : undefined;

  if (project === undefined || address === undefined) {
    return null;
  }

  return (
    <div
      className={`border-rule flex min-h-12 min-w-0 flex-wrap items-center gap-2 border-b py-2 ${GUTTER}`}
      data-code-bar=""
    >
      <div className="columns:hidden flex shrink-0">
        <Files commit={address.page === "commit"} />
      </div>
      <ViewToggle address={address} project={project} />
      <RefSwitcher
        Choices={Choices}
        hrefAt={atRev(project, address)}
        project={project}
        rev={address.rev}
      />
      {head === undefined ? (
        <span className="flex-1" />
      ) : (
        <HeadCommit
          head={head.head}
          now={head.now}
          project={project}
          rev={address.rev}
        />
      )}
      <GoToFile Finder={Finder} project={project} rev={address.rev} />
      <CloneHere
        platformUrl={platformUrl}
        project={project}
        rev={address.rev}
      />
    </div>
  );
};
