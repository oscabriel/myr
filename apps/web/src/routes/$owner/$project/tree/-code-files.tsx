/**
 * The Code tab's file tree: the repository's paths at the page's revision, or
 * a commit's changed files. It stands in the side column from `columns`, and
 * in the code bar's Files sheet below it.
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

import { pathsAtom } from "../../../../client/code.ts";
import { ClientTree } from "../../../../features/code/client-tree.tsx";
import { codeAddressOf } from "../../../../features/code/code-address.ts";
import { CommitPageData } from "../../../../features/code/commit-page-data.ts";
import { drawnFiles, treeOrder } from "../../../../features/code/diff-model.ts";
import { useCodeFileKeys } from "../../../../features/code/file-keys.ts";
import { parseDiffHash } from "../../../../features/code/line-hash.ts";
import { COLUMNS_QUERY, useMedia } from "../../../../features/code/media.ts";
import {
  blobHref,
  diffAnchor,
  treeHref,
  whyHref,
} from "../../../../features/code/paths.ts";

const isProject = Schema.is(ProjectName);

const decode = Schema.decodeUnknownOption(CommitPageData);

const NONE: readonly ChangedFile[] = [];

const useCommitFiles = (): readonly ChangedFile[] => {
  const data: unknown = useMatch({
    from: "/$owner/$project/commit/$sha",
    select: (match) => match.loaderData,
    shouldThrow: false,
  });

  return useMemo(
    () =>
      Option.match(decode(data), {
        onNone: () => NONE,
        onSome: ({ diff }) => diff.files,
      }),
    [data]
  );
};

type Kind = "blob" | "tree" | "why";

const useCodeAddress = () => {
  const params = useParams({ strict: false });

  const pathname = useLocation({ select: (location) => location.pathname });

  const address = useMemo(
    () => Option.getOrUndefined(codeAddressOf(pathname)),
    [pathname]
  );

  const kind: Kind =
    address?.page === "blob" || address?.page === "why" ? address.page : "tree";

  return {
    kind,
    path: address?.page === "commits" ? undefined : address?.path,
    project: isProject(params.project) ? params.project : undefined,
    rev: address?.page === "refs" ? "main" : (address?.rev ?? "main"),
  };
};

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

export const CodeFiles = ({
  always = false,
}: {
  readonly always?: boolean;
}) => {
  const { kind, path, project, rev } = useCodeAddress();
  const wide = useMedia(COLUMNS_QUERY);

  return project === undefined ? null : (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 pt-3">
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

export const CommitFiles = ({
  always = false,
}: {
  readonly always?: boolean;
}) => {
  const router = useRouter();
  const wide = useMedia(COLUMNS_QUERY);
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
    <div className="min-h-0 flex-1 pt-3">
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

const ColumnBody = ({ commit }: { readonly commit: boolean }) =>
  commit ? <CommitFiles /> : <CodeFiles />;

// `React.lazy` takes a module's default export.
export default ColumnBody;
