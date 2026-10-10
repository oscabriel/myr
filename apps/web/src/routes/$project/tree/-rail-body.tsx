/**
 * What the code pages' rail and Files sheet hold, loaded in the browser
 * only (`-code-rail.tsx`): the ref line (main, a tag or a commit, as a
 * switcher), then the tree with its filter, filling the rest; choosing a
 * file moves the page with the router, never reloading the document. On
 * a commit's page, the files it changed, open, marked A, M or D with their
 * `+n −m`; choosing one scrolls the diff to it.
 *
 * `J` and `K` move to the next or previous file, in the tree's order.
 * Not a route: the `-` prefix keeps the router from reading it as one.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ChangedFile } from "@repo/protocol/domain/code";
import { ProjectName } from "@repo/protocol/ids";
import {
  ClientOnly,
  useLocation,
  useMatch,
  useParams,
  useRouter,
} from "@tanstack/react-router";
import { Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";

import { pathsAtom, refsAtom } from "../../../client/code.ts";
import { ClientTree } from "../../../features/code/client-tree.tsx";
import { drawnFiles, treeOrder } from "../../../features/code/diff-model.ts";
import { useCodeFileKeys } from "../../../features/code/file-keys.ts";
import { parseDiffHash } from "../../../features/code/line-hash.ts";
import { SHELL_QUERY, useMedia } from "../../../features/code/media.ts";
import {
  blobHref,
  diffAnchor,
  treeHref,
  whyHref,
} from "../../../features/code/paths.ts";
import { RefSwitcher } from "../../../features/code/ref-switcher.tsx";
import { CommitPageData } from "./-commit-files.ts";

const isProject = Schema.is(ProjectName);

const decode = Schema.decodeUnknownOption(CommitPageData);

const NONE: readonly ChangedFile[] = [];

/** The files the commit on the page changed; none while its data is not there. */
const useCommitFiles = (): readonly ChangedFile[] => {
  const data: unknown = useMatch({
    from: "/$project/commit/$sha",
    select: (match) => match.loaderData,
    shouldThrow: false,
  });

  // Decoded once per read, not on every move between files.
  return useMemo(
    () =>
      Option.match(decode(data), {
        onNone: () => NONE,
        onSome: ({ diff }) => diff.files,
      }),
    [data]
  );
};

/** Which page of a file the address is: its folder, its code, or why. */
type Kind = "blob" | "tree" | "why";

/** Where the reader is in the code: the project, the revision and the path, and which page. */
const useCodeAddress = () => {
  const params = useParams({ strict: false });

  const kind = useLocation({
    select: ({ pathname }): Kind => {
      const second = pathname.split("/").at(2);

      return second === "blob" || second === "why" ? second : "tree";
    },
  });

  const project = isProject(params.project) ? params.project : undefined;
  const rev = params.rev ?? "main";

  const path =
    params._splat === undefined || params._splat === ""
      ? undefined
      : params._splat;

  return { kind, path, project, rev };
};

/** The page of `kind` for `path` at `rev`. */
const hrefFor = (
  project: ProjectName,
  kind: Kind,
  rev: string,
  path: string | undefined
) => {
  if (path === undefined || kind === "tree") {
    return treeHref(project, rev, path);
  }

  return (kind === "why" ? whyHref : blobHref)(project, rev, path);
};

/** The ref line: the revision, and the switcher to the same page at another. */
const RefLine = ({
  kind,
  path,
  project,
  rev,
}: {
  readonly kind: Kind;
  readonly path: string | undefined;
  readonly project: ProjectName;
  readonly rev: string;
}) => {
  const refs = useAtomValue(refsAtom(project));

  return (
    <div className="border-rule flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <RefSwitcher
        hrefAt={(at) => hrefFor(project, kind, at, path)}
        refs={Option.getOrUndefined(AsyncResult.value(refs))}
        rev={rev}
      />
    </div>
  );
};

/** The tree of every path at the revision, and the keys between its files. */
const ProjectTree = ({
  kind,
  path,
  project,
  rev,
  shown,
}: {
  readonly kind: Kind;
  readonly path: string | undefined;
  readonly project: ProjectName;
  readonly rev: string;
  /** Whether the tree is on screen here (the rail is not below the shell's width). */
  readonly shown: boolean;
}) => {
  const router = useRouter();
  const read = useAtomValue(pathsAtom({ at: rev, project }));

  // Past the platform's cap on paths the page works from its own list.
  const paths = Option.getOrUndefined(
    Option.flatMap(AsyncResult.value(read), (listed) =>
      listed.truncated ? Option.none() : Option.some(listed.paths)
    )
  );

  const open = (file: string) => {
    router.history.push(
      hrefFor(project, kind === "tree" ? "blob" : kind, rev, file)
    );
  };

  const ordered = useMemo(() => (paths ?? []).toSorted(treeOrder), [paths]);

  useCodeFileKeys(ordered, path, open);

  return shown && paths !== undefined ? (
    <ClientTree
      current={path}
      key={`${project}@${rev}`}
      onOpen={open}
      paths={paths}
    />
  ) : null;
};

/** A folder's, a file's or a why page's files: the ref line, then the tree. */
export const CodeFiles = ({
  always = false,
}: {
  readonly always?: boolean;
}) => {
  const { kind, path, project, rev } = useCodeAddress();
  const wide = useMedia(SHELL_QUERY);

  return project === undefined ? null : (
    <div className="flex min-h-0 flex-1 flex-col">
      <RefLine kind={kind} path={path} project={project} rev={rev} />
      <div className="min-h-0 flex-1 pt-1">
        <ClientOnly fallback={null}>
          <ProjectTree
            kind={kind}
            path={path}
            project={project}
            rev={rev}
            shown={always || wide}
          />
        </ClientOnly>
      </div>
    </div>
  );
};

/** A commit's changed files, marked by how, and the keys between them. */
export const CommitFiles = ({
  always = false,
}: {
  readonly always?: boolean;
}) => {
  const router = useRouter();
  const wide = useMedia(SHELL_QUERY);
  const files = useCommitFiles();
  const hash = useLocation({ select: (location) => location.hash });

  const current = Option.getOrUndefined(
    Option.map(parseDiffHash(hash), ({ path }) => path)
  );

  const drawn = useMemo(() => drawnFiles(files), [files]);
  const paths = useMemo(() => drawn.map(({ file }) => file.path), [drawn]);

  const counts = useMemo(
    () => new Map(drawn.map(({ counts: each, file }) => [file.path, each])),
    [drawn]
  );

  const status = useMemo(
    () => drawn.map(({ file }) => ({ path: file.path, status: file.status })),
    [drawn]
  );

  const open = (path: string) => {
    const { pathname, searchStr } = router.state.location;

    router.history.replace(`${pathname}${searchStr}#${diffAnchor(path)}`);
  };

  useCodeFileKeys(paths, current, open);

  return always || wide ? (
    <div className="min-h-0 flex-1 pt-1">
      <ClientTree
        counts={counts}
        current={current}
        key={paths.join("\n")}
        onOpen={open}
        open
        paths={paths}
        status={status}
      />
    </div>
  ) : null;
};

/** The rail's body: a commit's changed files, or the project's. */
const RailBody = ({ commit }: { readonly commit: boolean }) =>
  commit ? <CommitFiles /> : <CodeFiles />;

// `React.lazy` takes a module's default export.
export default RailBody;
