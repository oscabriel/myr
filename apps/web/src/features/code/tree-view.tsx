/**
 * One folder of a project at a revision: where it sits (a breadcrumb of
 * its ancestors, each a link at the same revision), its entries (folders
 * first, as `readTree` orders them) and its README below. Props in, markup
 * out: the server renders all of it, and the browser adds the file tree
 * (`sidebar`, client-only, from `client-tree.tsx`) beside it.
 */
import type {
  CodeEntry,
  FileView,
  TreeListing,
} from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import { Match, Option } from "effect";
import { File, FileSymlink, Folder, FolderGit2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Fragment } from "react";
import type { ReactNode } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { RepoMarkdown } from "../markdown/markdown.tsx";
import { ProjectNav } from "../project/project-nav.tsx";
import { PageShell } from "../shared/layout.tsx";
import { ancestorsOf, blobHref, dirOf, treeHref } from "./paths.ts";

const LINK = "decoration-rule underline hover:decoration-current";

/** Each kind of entry: its mark and the word a screen reader says for it. */
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

/** Where an entry's row links: a folder's page or a file's; a submodule's commit lives elsewhere. */
const entryHref = (project: ProjectName, rev: string, entry: CodeEntry) =>
  Match.value(entry.type).pipe(
    Match.when("tree", () => Option.some(treeHref(project, rev, entry.path))),
    Match.when("submodule", () => Option.none<string>()),
    Match.orElse(() => Option.some(blobHref(project, rev, entry.path)))
  );

/** A folder's entries, one row each, each linking its page at `rev`. */
export const EntriesTable = ({
  entries,
  project,
  rev,
}: {
  readonly entries: readonly CodeEntry[];
  readonly project: ProjectName;
  readonly rev: string;
}) => (
  <Table className="font-mono text-[0.8125rem]">
    <TableHeader>
      <TableRow>
        <TableHead className="font-sans">Name</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {entries.map((entry) => {
        const { icon: Icon, word } = kinds(entry.type);
        const href = Option.getOrUndefined(entryHref(project, rev, entry));

        return (
          <TableRow data-entry={entry.path} key={entry.path}>
            <TableCell className="flex min-w-0 items-center gap-2 whitespace-normal">
              <Icon
                aria-hidden="true"
                className="text-muted-foreground size-4 shrink-0"
              />
              <span className="sr-only">{word}:</span>
              {href === undefined ? (
                <span className="[overflow-wrap:anywhere]">{entry.name}</span>
              ) : (
                <a className={`${LINK} [overflow-wrap:anywhere]`} href={href}>
                  {entry.name}
                </a>
              )}
            </TableCell>
          </TableRow>
        );
      })}
    </TableBody>
  </Table>
);

/**
 * Where `path` sits in the project at `rev`: the project, then each folder
 * above it, each a link to its folder at `rev`, then `path`'s own name.
 */
export const CodeBreadcrumb = ({
  path,
  project,
  rev,
}: {
  readonly path?: string | undefined;
  readonly project: ProjectName;
  readonly rev: string;
}) => {
  const here = path === undefined || path === "" ? undefined : path;
  const name = here?.split("/").at(-1);

  return (
    <Breadcrumb>
      <BreadcrumbList className="font-mono text-[0.8125rem]">
        <BreadcrumbItem>
          {here === undefined ? (
            <BreadcrumbPage>{project}</BreadcrumbPage>
          ) : (
            <BreadcrumbLink href={treeHref(project, rev)}>
              {project}
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {here === undefined
          ? null
          : ancestorsOf(here).map((folder) => (
              <Fragment key={folder}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink href={treeHref(project, rev, folder)}>
                    {folder.split("/").at(-1)}
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </Fragment>
            ))}
        {name === undefined ? null : (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{name}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
};

/** A README (or any Markdown file), rendered, under its own name. */
export const ReadmeSection = ({
  file,
  project,
}: {
  readonly file: FileView;
  readonly project: ProjectName;
}) => (
  <section
    aria-label={file.path}
    className="border-rule flex min-w-0 flex-col gap-3 border-t pt-4"
    data-readme={file.path}
  >
    <h2 className="text-muted-foreground font-mono text-xs font-medium">
      {file.path.split("/").at(-1)}
    </h2>
    {file.text === undefined ? (
      <p className="text-muted-foreground text-sm">
        This file is too large to show here.
      </p>
    ) : (
      <RepoMarkdown
        at={file.at}
        dir={dirOf(file.path)}
        project={project}
        source={file.text}
      />
    )}
  </section>
);

/** The revision a page reads, beside its title: a commit by its short id. */
export const revLabel = (rev: string) =>
  /^[0-9a-f]{40}$/u.test(rev) ? rev.slice(0, 7) : rev;

/** A code page's frame: title, nav, and the file tree's column beside the content. */
export const CodeLayout = ({
  children,
  project,
  sidebar,
  title,
}: {
  readonly children: ReactNode;
  readonly project: ProjectName;
  readonly sidebar?: ReactNode;
  readonly title: string;
}) => (
  <PageShell title={title}>
    <ProjectNav current="code" project={project} />
    <div className="grid min-w-0 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      {sidebar === undefined ? null : (
        <aside
          aria-label="Files"
          className="max-h-[40dvh] min-w-0 overflow-hidden lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:self-start"
        >
          {sidebar}
        </aside>
      )}
      <div
        className={`flex min-w-0 flex-col gap-4 ${sidebar === undefined ? "lg:col-span-2" : ""}`}
      >
        {children}
      </div>
    </div>
  </PageShell>
);

export const TreeView = ({
  listing,
  project,
  readme,
  rev,
  sidebar,
}: {
  readonly listing: TreeListing;
  readonly project: ProjectName;
  /** The folder's README, read; absent when it has none or it is not read yet. */
  readonly readme?: FileView | undefined;
  readonly rev: string;
  /** The file tree, drawn in the browser. */
  readonly sidebar?: ReactNode;
}) => (
  <CodeLayout
    project={project}
    sidebar={sidebar}
    title={
      listing.path === undefined
        ? `${project} at ${revLabel(rev)}`
        : `${listing.path} at ${revLabel(rev)}`
    }
  >
    <CodeBreadcrumb path={listing.path} project={project} rev={rev} />
    <EntriesTable entries={listing.entries} project={project} rev={rev} />
    {readme === undefined ? null : (
      <ReadmeSection file={readme} project={project} />
    )}
  </CodeLayout>
);
