/**
 * The code browser's client-only drawings, rendered directly (as
 * `finish.test.tsx` renders `patch-diff.tsx`): a file and a commit's diff
 * are drawn by `@pierre/diffs` (`<diffs-container>`), and the repo's file
 * tree by `@pierre/trees` (`<file-tree-container>`). The pages import these
 * only behind `ClientOnly` and a lazy import, so the Worker never bundles
 * them (`code.test.tsx` holds the server side).
 */
import { describe, expect, it } from "@effect/vitest";
import { ChangedFile } from "@repo/protocol/domain/code";
import { Schema } from "effect";
import { renderToStaticMarkup } from "react-dom/server";

import { FileCode } from "../src/features/code/code-view.tsx";
import { DiffCode } from "../src/features/code/diff-view.tsx";
import { RepoTree } from "../src/features/code/repo-tree.tsx";

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
  });

  it("draw a commit's diff with @pierre/diffs, one view per changed file, named", () => {
    const markup = renderToStaticMarkup(
      <DiffCode files={files} split={false} />
    );

    const views = [
      ...markup.matchAll(
        /<section\b[^>]*aria-label="(?<file>[^"]+)"[^>]*><diffs-container\b/gu
      ),
    ].map((view) => view.groups?.file);

    expect(views).toStrictEqual(["src/parse.ts", "src/week.ts"]);
  });

  it("draw the repo's file tree with @pierre/trees", () => {
    const markup = renderToStaticMarkup(
      <RepoTree
        current="src/parse.ts"
        hrefOf={(path) => `/datekit/blob/main/${path}`}
        paths={["README.md", "src/parse.ts", "src/week.ts"]}
      />
    );

    expect(markup).toContain("<file-tree-container");
  });
});
