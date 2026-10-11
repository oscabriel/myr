/**
 * The code browser's client-only drawings, rendered directly (as
 * `finish.test.tsx` renders `patch-diff.tsx`): a file is drawn by
 * `@pierre/diffs` (`<diffs-container>`), a commit's diff by its `CodeView`
 * (which draws nothing until it mounts, so its server markup is its
 * marked host alone; `code.test.tsx` holds the plain text it replaces), and
 * the repo's file tree by `@pierre/trees` (`<file-tree-container>`). The
 * pages import these only through a dynamic import the Worker's build
 * drops, so the Worker never bundles them (the server's own highlighting
 * is `code-prerender.test.tsx`'s).
 *
 * The tree moves the page through the router: choosing a file calls the
 * page's own `onOpen`, never `location.assign`, so the document stays.
 */
import { describe, expect, it } from "@effect/vitest";
import { FileTree } from "@pierre/trees";
import { ChangedFile } from "@repo/protocol/domain/code";
import { Schema } from "effect";
import { renderToStaticMarkup } from "react-dom/server";

import { FileCode } from "../src/features/code/code-view.tsx";
import { DiffCode } from "../src/features/code/diff-view.tsx";
import {
  followChoices,
  RepoTree,
  filterTree,
  treeOptionsFor,
} from "../src/features/code/repo-tree.tsx";

const files = Schema.decodeSync(Schema.Array(ChangedFile))([
  {
    after: "a".repeat(40),
    before: "b".repeat(40),
    binary: false,
    newText: "export const parse = fromIso;\n",
    oldText: "export const parse = Date;\n",
    path: "src/parse.ts",
    status: "modified",
  },
  {
    after: "c".repeat(40),
    binary: false,
    newText: "export const week = 1;\n",
    path: "src/week.ts",
    status: "added",
  },
]);

const PATHS = ["README.md", "src/parse.ts", "src/week.ts"];

describe("the client-only drawings", () => {
  it("draw a file with @pierre/diffs", () => {
    const markup = renderToStaticMarkup(
      <FileCode
        path="src/parse.ts"
        sha={"e".repeat(40)}
        text={"one\ntwo\nthree\n"}
      />
    );

    expect(markup).toContain("<diffs-container");
    expect(markup).toContain('data-code="pierre"');
  });

  it("draw a commit's diff with one CodeView, which fills the pane and scrolls in it", () => {
    const markup = renderToStaticMarkup(
      <DiffCode files={files} split={false} />
    );

    expect(markup).toContain('data-diff="pierre"');
    expect(markup).toMatch(/class="[^"]*\bflex-1\b[^"]*\boverflow-auto\b/u);
  });

  it("draw the repo's file tree with @pierre/trees", () => {
    const markup = renderToStaticMarkup(
      <RepoTree
        current="src/parse.ts"
        onOpen={() => {
          // Nothing is chosen in a server render.
        }}
        paths={PATHS}
      />
    );

    expect(markup).toContain("<file-tree-container");
  });
});

/** A tree over `PATHS` showing `current`, and the files it asked the page to open. */
const treeAt = (current: string) => {
  const opened: string[] = [];
  const tree = new FileTree(treeOptionsFor({ current, paths: PATHS }));

  followChoices(tree, current, (path) => {
    opened.push(path);
  });

  return { opened, tree };
};

describe("the file tree", () => {
  it("hands a chosen file to the page, which moves with the router", () => {
    const { opened, tree } = treeAt("src/parse.ts");

    tree.getItem("src/week.ts")?.select();

    expect(opened).toStrictEqual(["src/week.ts"]);
  });

  it("asks nothing for the page's own file, or a folder", () => {
    const { opened, tree } = treeAt("src/parse.ts");

    tree.getItem("src/parse.ts")?.select();
    tree.getItem("src/")?.select();

    expect(opened).toStrictEqual([]);
  });

  it("sets a flattened row's leading folders muted and its last name in ink, so the name reads first", () => {
    const css = treeOptionsFor({ paths: PATHS }).unsafeCSS ?? "";

    expect(css).toMatch(
      /\[data-item-flattened-subitems\]\s*\{[^}]*color:\s*var\(--muted\)/u
    );
    expect(css).toMatch(
      /\[data-item-flattened-subitem\]:last-child\s*\{[^}]*color:\s*var\(--foreground\)/u
    );
  });

  it("keeps its filter outside the tree, which holds only rows", () => {
    const { tree } = treeAt("src/parse.ts");

    // A field inside a tree's role is not one of its rows to a screen
    // reader: the filter sits above the tree and narrows it from there.
    expect(treeOptionsFor({ paths: PATHS }).search).toBeFalsy();

    filterTree(tree, "week");

    expect(tree.getSearchValue()).toBe("week");

    filterTree(tree, "");

    expect(tree.isSearchOpen()).toBeFalsy();
  });

  it("opens the folders above the page's file, and selects it", () => {
    const { tree } = treeAt("src/parse.ts");

    expect(tree.getSelectedPaths()).toStrictEqual(["src/parse.ts"]);
    expect(tree.getItem("src/")?.isDirectory()).toBeTruthy();
  });

  const sources: Readonly<Record<string, string>> = import.meta.glob(
    "../src/features/code/repo-tree.tsx",
    { eager: true, import: "default", query: "?raw" }
  );

  it("never reloads the document to open a file", () => {
    const [source = ""] = Object.values(sources);

    expect(source).toContain("onOpen");
    expect(source).not.toMatch(/location\.(?:assign|href\s*=|replace)/u);
  });
});
