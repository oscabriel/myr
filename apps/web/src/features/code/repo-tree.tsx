/**
 * A project's files as a tree, drawn by `@pierre/trees`, with the current
 * path open and selected. Choosing a file opens `hrefOf(path)`: its page,
 * or on a commit's page its diff. Folders open in place. `status` marks the
 * files a commit changed (and their folders).
 *
 * The paths arrive as plain strings and are prepared here, never on the
 * server (a prepared input's symbol key does not serialize). Only the
 * browser loads this module (`client-tree.tsx`).
 */
import { prepareFileTreeInput } from "@pierre/trees";
import type { GitStatusEntry } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { useEffect, useMemo } from "react";

import { ancestorsOf } from "./paths.ts";

export interface RepoTreeProps {
  /** The path the page shows, a file or a folder. */
  readonly current?: string | undefined;
  /** Where choosing the file `path` goes. */
  readonly hrefOf: (path: string) => string;
  readonly paths: readonly string[];
  /** The files a commit changed; none on a code page. */
  readonly status?: readonly GitStatusEntry[];
}

/** A tree with no file marked. */
const NO_STATUS: readonly GitStatusEntry[] = [];

export const RepoTree = ({
  current,
  hrefOf,
  paths,
  status = NO_STATUS,
}: RepoTreeProps) => {
  const preparedInput = useMemo(() => prepareFileTreeInput(paths), [paths]);

  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    id: "repo-tree",
    initialExpandedPaths:
      current === undefined
        ? []
        : [...ancestorsOf(current), current].map((folder) => `${folder}/`),
    initialSelectedPaths: current === undefined ? [] : [current],
    onSelectionChange: (selected) => {
      const path = selected.at(-1);

      if (path !== undefined && !path.endsWith("/") && path !== current) {
        globalThis.location.assign(hrefOf(path));
      }
    },
    preparedInput,
    search: true,
    gitStatus: status,
  });

  // Keep the page's own path in view.
  useEffect(() => {
    if (current !== undefined) {
      model.scrollToPath(current, { focus: false, offset: "nearest" });
    }
  }, [model, current]);

  // The tree scrolls inside itself, so it needs a definite height: a
  // minimum leaves its rows clipped to nothing.
  return (
    <FileTree className="h-[40dvh] lg:h-[calc(100dvh-2rem)]" model={model} />
  );
};

// `React.lazy` takes a module's default export.
export default RepoTree;
