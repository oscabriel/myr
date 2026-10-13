import type {
  CodeEntry,
  CommitView,
  FileView,
  TreeListing,
} from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import { Match, Option } from "effect";
import type { DateTime } from "effect";
import { File, FileSymlink, Folder, FolderGit2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ReadmeSection } from "../project/readme-section.tsx";
import { AppLink } from "../shared/link.tsx";
import { GUTTER } from "../shared/shell/gutter.ts";
import { MEASURE, Workspace } from "../shared/shell/workspace.tsx";
import { When } from "../shared/time.tsx";
import { askOf } from "../why/rows.ts";
import { FileHeader } from "./file-header.tsx";
import { blobHref, commitsHref, treeHref } from "./paths.ts";

const kinds = Match.type<CodeEntry["type"]>().pipe(
  Match.when("tree", () => ({ icon: Folder, word: "Folder" })),
  Match.when("blob", () => ({ icon: File, word: "File" })),
  Match.when("symlink", () => ({ icon: FileSymlink, word: "Link" })),
  Match.when("submodule", () => ({ icon: FolderGit2, word: "Submodule" })),
  Match.exhaustive
) satisfies (type: CodeEntry["type"]) => {
  readonly icon: LucideIcon;
  readonly word: string;
};

const entryHref = (project: ProjectName, rev: string, entry: CodeEntry) =>
  Match.value(entry.type).pipe(
    Match.when("tree", () => Option.some(treeHref(project, rev, entry.path))),
    Match.when("submodule", () => Option.none<string>()),
    Match.orElse(() => Option.some(blobHref(project, rev, entry.path)))
  );

const changeWords = (commit: CommitView) => {
  const linked =
    commit.landing === undefined
      ? undefined
      : Option.getOrUndefined(askOf(commit.landing));

  if (linked === undefined) {
    return commit.subject === "" ? "(no subject)" : commit.subject;
  }

  return linked.kind === "opened" ? `opened ${linked.ask}` : linked.ask;
};

const LINK =
  "text-foreground no-underline outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring focus-visible:after:outline-solid";

const EntryRow = ({
  entry,
  last,
  now,
  project,
  rev,
}: {
  readonly entry: CodeEntry;
  readonly last?: CommitView | undefined;
  readonly now?: DateTime.Utc | undefined;
  readonly project: ProjectName;
  readonly rev: string;
}) => {
  const { icon: Icon, word } = kinds(entry.type);
  const href = Option.getOrUndefined(entryHref(project, rev, entry));

  return (
    <li
      className="group/row border-rule hover:bg-surface/50 relative isolate -mx-2 flex h-10 min-w-0 items-center gap-3 border-b px-2 transition-colors duration-[120ms]"
      data-entry={entry.path}
    >
      <Icon
        aria-hidden="true"
        className="text-muted-foreground size-4 shrink-0"
        strokeWidth={1.75}
      />
      <span className="sr-only">{word}:</span>
      <span className="text-ui min-w-0 shrink-0 basis-[14rem] truncate font-medium">
        {href === undefined ? (
          entry.name
        ) : (
          <AppLink className={LINK} title={entry.name} to={href}>
            {entry.name}
          </AppLink>
        )}
      </span>
      <span
        className="text-ui text-muted-foreground tablet:block hidden min-w-0 flex-1 truncate"
        data-last=""
      >
        {last === undefined ? null : changeWords(last)}
      </span>
      <span className="text-label text-muted-foreground ml-auto shrink-0 tabular-nums">
        {last === undefined || now === undefined ? null : (
          <When at={last.committer.at} now={now} />
        )}
      </span>
    </li>
  );
};

export const EntriesTable = ({
  entries,
  project,
  rev,
}: {
  readonly entries: readonly CodeEntry[];
  readonly project: ProjectName;
  readonly rev: string;
}) => (
  <ul className="border-rule flex flex-col border-t" data-entries="">
    {entries.map((entry) => (
      <EntryRow entry={entry} key={entry.path} project={project} rev={rev} />
    ))}
  </ul>
);

export interface TreeViewProps {
  readonly listing: TreeListing;
  readonly project: ProjectName;
  readonly rev: string;
  readonly readme?: FileView | undefined;
  readonly last?: ReadonlyMap<string, CommitView>;
  readonly now: DateTime.Utc;
  readonly notice?: ReactNode;
}

export const TreeView = ({
  last,
  listing,
  notice,
  now,
  project,
  readme,
  rev,
}: TreeViewProps) => {
  const name = listing.path?.split("/").at(-1) ?? project;

  return (
    <Workspace
      crumbs={[
        { label: project, to: `/${project}` },
        listing.path === undefined
          ? { label: "Code" }
          : { label: "Code", to: `/${project}/tree/main` },
        ...(listing.path === undefined ? [] : [{ label: name, mono: true }]),
      ]}
      title={name}
      toolbar={
        <>
          <FileHeader path={listing.path} project={project} rev={rev} />
          <AppLink
            className="text-ui text-muted-foreground hover:text-foreground tablet:inline hidden shrink-0 no-underline"
            search={listing.path === undefined ? {} : { path: listing.path }}
            to={commitsHref(project, rev)}
          >
            History
          </AppLink>
        </>
      }
      variant="code"
    >
      <div className={`${GUTTER} ${MEASURE} flex flex-col gap-8`}>
        {notice}
        <ul
          aria-label={`${name}'s entries`}
          className="border-rule flex flex-col border-t"
          data-entries=""
        >
          {listing.entries.map((entry) => (
            <EntryRow
              entry={entry}
              key={entry.path}
              last={last?.get(entry.path)}
              now={now}
              project={project}
              rev={rev}
            />
          ))}
        </ul>
        {readme === undefined ? null : (
          <ReadmeSection file={readme} project={project} />
        )}
      </div>
    </Workspace>
  );
};
