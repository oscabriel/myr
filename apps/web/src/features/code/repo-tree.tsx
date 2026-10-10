/**
 * A project's files as a tree, drawn by `@pierre/trees`, in the UI's own
 * face: compact rows, plain grey icons, single-child folders flattened
 * into one row, the folders above the visible rows kept at the top as the
 * reader scrolls, and a filter. The current path is open, selected and in
 * view; when it changes (the reader moved to another file and the tree
 * stayed mounted), the tree follows.
 *
 * Choosing a file calls `onOpen`, which the page answers through the
 * router: the document is never reloaded, so the tree stays where it is.
 * On a commit's page the tree lists the changed files, open, each marked
 * A, M or D and with its `+n −m`.
 *
 * Only the browser loads this module (`client-tree.tsx`): the paths arrive
 * as plain strings and are prepared here.
 */
import { prepareFileTreeInput } from "@pierre/trees";
import type {
  FileTree,
  FileTreeDirectoryHandle,
  FileTreeItemHandle,
  FileTreeOptions,
  FileTreeRowDecoration,
  GitStatusEntry,
} from "@pierre/trees";
import { FileTree as FileTreeView, useFileTree } from "@pierre/trees/react";
import { useEffect, useMemo } from "react";

import type { Counts } from "./diff-model.ts";
import { ancestorsOf } from "./paths.ts";
import { treesOptions } from "./pierre.ts";

export interface RepoTreeProps {
  readonly paths: readonly string[];
  /** The path the page shows, a file or a folder; none on a commit's page until one is chosen. */
  readonly current?: string | undefined;
  /** A file was chosen. */
  readonly onOpen: (path: string) => void;
  /** The files a commit changed, marked by how. */
  readonly status?: readonly GitStatusEntry[];
  /** What each changed file adds and removes, at its row's end. */
  readonly counts?: ReadonlyMap<string, Counts>;
  /** Every folder open from the start (a commit's few changed files). */
  readonly open?: boolean;
}

const NO_STATUS: readonly GitStatusEntry[] = [];

/** The page's own row: its name set heavier than its neighbours'. */
const SELECTED_CSS =
  "[data-type='item'][aria-selected='true'] { font-weight: 600; color: var(--foreground); }";

/** A folder's id in the tree: its path and a slash. */
const folderId = (path: string) => `${path}/`;

/** What `current` opens: each folder above it, and itself when it is a folder. */
const openFor = (current: string | undefined) =>
  current === undefined || current === ""
    ? []
    : [...ancestorsOf(current), current].map(folderId);

/** A changed file's `+n −m`, each part in the diff's own tint. */
const decorationOf = (counts: Counts): FileTreeRowDecoration => ({
  parts: [
    { color: "var(--diff-add-sign)", text: `+${counts.additions}` },
    { text: " " },
    { color: "var(--diff-del-sign)", text: `−${counts.deletions}` },
  ],
  text: `+${counts.additions} −${counts.deletions}`,
  title: `${counts.additions} added, ${counts.deletions} removed`,
});

/** The tree's options for `props`: its look, the page's path open and selected. */
export const treeOptionsFor = (
  props: Omit<RepoTreeProps, "onOpen">,
  preparedInput = prepareFileTreeInput(props.paths)
): FileTreeOptions => {
  const { counts, current, open = false, status = NO_STATUS } = props;

  const options: FileTreeOptions = {
    ...treesOptions,
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    gitStatus: status,
    id: "repo-tree",
    initialExpandedPaths: openFor(current),
    initialExpansion: open ? "open" : "closed",
    initialSelectedPaths: current === undefined ? [] : [current],
    preparedInput,
    search: true,
    stickyFolders: true,
    // The selected row's fill is faint on paper: its name in ink at 600
    // says it too.
    unsafeCSS: SELECTED_CSS,
  };

  if (counts !== undefined) {
    options.renderRowDecoration = ({ item }) => {
      const changed = counts.get(item.path);

      return changed === undefined ? null : decorationOf(changed);
    };
  }

  return options;
};

/**
 * Hand the page each file the reader chooses in `tree` (never a folder,
 * never the page's own file); the returned function stops.
 */
export const followChoices = (
  tree: Pick<FileTree, "getSelectedPaths" | "subscribe">,
  current: string | undefined,
  onOpen: (path: string) => void
) =>
  tree.subscribe(() => {
    const path = tree.getSelectedPaths().at(-1);

    if (path !== undefined && !path.endsWith("/") && path !== current) {
      onOpen(path);
    }
  });

/** Whether a tree item is a folder, which opens. */
const isFolder = (item: FileTreeItemHandle): item is FileTreeDirectoryHandle =>
  item.isDirectory();

export const RepoTree = (props: RepoTreeProps) => {
  const { current, onOpen } = props;

  // The tree is made from its first options: the page keys it by project
  // and revision, so a new set of paths is a new tree.
  const preparedInput = useMemo(
    () => prepareFileTreeInput(props.paths),
    [props.paths]
  );

  const { model } = useFileTree(treeOptionsFor(props, preparedInput));

  useEffect(
    () => followChoices(model, current, onOpen),
    [model, current, onOpen]
  );

  // Follow the page: open the folders above its path, select it alone,
  // and bring it into view.
  useEffect(() => {
    if (current === undefined || current === "") {
      return;
    }

    for (const folder of openFor(current)) {
      const item = model.getItem(folder);

      if (item !== null && isFolder(item)) {
        item.expand();
      }
    }

    for (const selected of model.getSelectedPaths()) {
      if (selected !== current) {
        model.getItem(selected)?.deselect();
      }
    }

    const here = model.getItem(current) ?? model.getItem(folderId(current));

    if (here !== null && !here.isSelected()) {
      here.select();
    }

    model.scrollToPath(current, { focus: false, offset: "nearest" });
  }, [model, current]);

  // The tree scrolls inside itself, so it takes the height its box gives.
  return <FileTreeView className="block h-full min-h-0" model={model} />;
};

// `React.lazy` takes a module's default export.
export default RepoTree;
