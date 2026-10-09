import { useAtomValue } from "@effect/atom-react";
import type { ProjectName } from "@repo/protocol/ids";
import { ClientOnly } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";

import { pathsAtom } from "../../../client/code.ts";
import { ClientTree } from "../../../features/code/client-tree.tsx";
import { blobHref } from "../../../features/code/paths.ts";

// The file tree beside a folder or a file: every path at the page's commit
// (`listPaths`), read and drawn in the browser only. While it loads, when
// the read fails, or past the platform's cap on paths, the column shows
// nothing and the page works from its own table. Not a route: the `-`
// prefix keeps the router from reading it as one.

const Paths = ({
  at,
  current,
  project,
  rev,
}: {
  readonly at: string;
  readonly current?: string | undefined;
  readonly project: ProjectName;
  readonly rev: string;
}) => {
  const read = useAtomValue(pathsAtom({ at, project }));

  return AsyncResult.match(read, {
    onFailure: () => null,
    onInitial: () => null,
    onSuccess: ({ value }) =>
      value.truncated ? null : (
        <ClientTree
          current={current}
          hrefOf={(path) => blobHref(project, rev, path)}
          paths={value.paths}
        />
      ),
  });
};

export const PathsTree = (props: {
  /** The commit the page resolved: the paths are read there. */
  readonly at: string;
  readonly current?: string | undefined;
  readonly project: ProjectName;
  /** The revision the page's links keep. */
  readonly rev: string;
}) => (
  <ClientOnly fallback={null}>
    <Paths {...props} />
  </ClientOnly>
);
