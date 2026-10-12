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

import { Input } from "@/components/ui/input";

import type { Counts } from "./diff-model.ts";
import { ancestorsOf } from "./paths.ts";
import { treesOptions } from "./pierre.ts";

export interface RepoTreeProps {
  readonly paths: readonly string[];
  readonly current?: string | undefined;
  readonly onOpen: (path: string) => void;
  readonly status?: readonly GitStatusEntry[];
  readonly counts?: ReadonlyMap<string, Counts>;
  readonly open?: boolean;
}

const NO_STATUS: readonly GitStatusEntry[] = [];

const TREE_CSS = [
  "[data-type='item'][aria-selected='true'] { font-weight: 600; color: var(--foreground); }",
  "[data-item-flattened-subitems] { color: var(--muted); }",
  "[data-item-flattened-subitem]:last-child { color: var(--foreground); }",
].join("\n");

const folderId = (path: string) => `${path}/`;

const openFor = (current: string | undefined) =>
  current === undefined || current === ""
    ? []
    : [...ancestorsOf(current), current].map(folderId);

const decorationOf = (counts: Counts): FileTreeRowDecoration => ({
  parts: [
    { color: "var(--diff-add-sign)", text: `+${counts.additions}` },
    // A no-break space: the row lays its parts out as boxes, where a plain
    // space collapses to nothing.
    { text: "\u00A0" },
    { color: "var(--diff-del-sign)", text: `−${counts.deletions}` },
  ],
  text: `+${counts.additions} −${counts.deletions}`,
  title: `${counts.additions} added, ${counts.deletions} removed`,
});

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
    // A field inside the tree's role would not be one of its rows to a screen
    // reader.
    search: false,
    stickyFolders: true,
    unsafeCSS: TREE_CSS,
  };

  if (counts !== undefined) {
    options.renderRowDecoration = ({ item }) => {
      const changed = counts.get(item.path);

      return changed === undefined ? null : decorationOf(changed);
    };
  }

  return options;
};

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

export const filterTree = (tree: Pick<FileTree, "setSearch">, text: string) => {
  tree.setSearch(text.trim() === "" ? null : text);
};

const isFolder = (item: FileTreeItemHandle): item is FileTreeDirectoryHandle =>
  item.isDirectory();

export const RepoTree = (props: RepoTreeProps) => {
  const { current, onOpen } = props;

  // Made from its first options: the page keys the tree by project and
  // revision.
  const preparedInput = useMemo(
    () => prepareFileTreeInput(props.paths),
    [props.paths]
  );

  const { model } = useFileTree(treeOptionsFor(props, preparedInput));

  useEffect(
    () => followChoices(model, current, onOpen),
    [model, current, onOpen]
  );

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pb-1.5">
        <Input
          aria-label="Filter files"
          data-keys-off=""
          onChange={(event) => {
            filterTree(model, event.currentTarget.value);
          }}
          placeholder="Filter files"
          type="search"
        />
      </div>
      <FileTreeView className="block min-h-0 flex-1" model={model} />
    </div>
  );
};

// `React.lazy` takes a module's default export.
export default RepoTree;
