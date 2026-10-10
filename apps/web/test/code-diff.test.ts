/**
 * A commit's diff as the server sends it and the browser draws it: both
 * parse a file's two texts with the drawing's own parser, so the plain
 * text holds the drawing's hunks line for line; a file's counts, which
 * files start folded, the order a tree lists paths in, the stats split by
 * the ask's territory, and the keys that move between files.
 */
import { describe, expect, it } from "@effect/vitest";
import { ChangedFile } from "@repo/protocol/domain/code";
import { Option, Schema } from "effect";

import {
  countsOf,
  drawnFiles,
  fileDiffOf,
  globTest,
  isTestPath,
  splitRows,
  statsOf,
  treeOrder,
  unifiedRows,
} from "../src/features/code/diff-model.ts";
import { stepFrom } from "../src/features/code/file-keys.ts";

const decode = Schema.decodeSync(ChangedFile);

/** Lines `from` to `to`, as a file's text. */
const lines = (from: number, to: number) =>
  `${Array.from(
    { length: to - from + 1 },
    (_, index) => `line ${from + index}`
  ).join("\n")}\n`;

const thirty = lines(1, 30);

const changed = decode({
  after: "a".repeat(40),
  before: "b".repeat(40),
  binary: false,
  newText: thirty.replace("line 15\n", "line fifteen\nline 15b\n"),
  oldText: thirty,
  path: "src/parse.ts",
  status: "modified",
});

describe("a changed file's diff", () => {
  it("is parsed into the hunks the drawing draws, keyed by both blobs", () => {
    const diff = fileDiffOf(changed);

    expect(Option.map(diff, ({ hunks }) => hunks.length)).toStrictEqual(
      Option.some(1)
    );
    expect(Option.map(diff, ({ cacheKey }) => cacheKey)).toStrictEqual(
      Option.some(`diff:${"b".repeat(40)}:${"a".repeat(40)}`)
    );
    expect(countsOf(diff)).toStrictEqual({ additions: 2, deletions: 1 });
  });

  it("reads as unified rows: the unchanged lines skipped before and after, each line numbered on its side", () => {
    const rows = Option.match(fileDiffOf(changed), {
      onNone: () => [],
      onSome: unifiedRows,
    });

    expect(rows[0]).toStrictEqual({ kind: "separator", lines: 10 });
    expect(rows.at(-1)).toStrictEqual({ kind: "separator", lines: 11 });
    expect(
      rows.filter((row) => row.kind !== "separator" && row.kind !== "context")
    ).toStrictEqual([
      { kind: "deletion", number: 15, text: "line 15" },
      { kind: "addition", number: 15, text: "line fifteen" },
      { kind: "addition", number: 16, text: "line 15b" },
    ]);
  });

  it("reads as split rows: the deletion beside the first addition, the second against nothing", () => {
    const rows = Option.match(fileDiffOf(changed), {
      onNone: () => [],
      onSome: splitRows,
    });

    const pairs = rows.filter(
      (row) =>
        row.kind === "pair" &&
        (row.left?.kind !== "context" || row.right === undefined)
    );

    expect(pairs).toStrictEqual([
      {
        kind: "pair",
        left: { kind: "deletion", number: 15, text: "line 15" },
        right: { kind: "addition", number: 15, text: "line fifteen" },
      },
      {
        kind: "pair",
        right: { kind: "addition", number: 16, text: "line 15b" },
      },
    ]);
  });

  it("has no lines for a binary file, or one whose text was not sent", () => {
    expect(
      fileDiffOf(decode({ binary: true, path: "logo.png", status: "added" }))
    ).toStrictEqual(Option.none());
    expect(
      fileDiffOf(
        decode({ binary: false, path: "big.json", status: "modified" })
      )
    ).toStrictEqual(Option.none());
  });
});

describe("a commit's files", () => {
  const files = [
    decode({
      binary: false,
      newText: lines(1, 81),
      path: "data/zones.ts",
      status: "added",
    }),
    decode({
      binary: false,
      oldText: lines(1, 80),
      path: "data/old.ts",
      status: "deleted",
    }),
    changed,
    decode({
      binary: false,
      newText: "it\n",
      path: "test/parse.test.ts",
      status: "added",
    }),
    decode({
      binary: false,
      newText: "x\n",
      path: "README.md",
      status: "added",
    }),
  ];

  it("are listed in the tree's order: folders before files, then by name", () => {
    expect(drawnFiles(files).map(({ file }) => file.path)).toStrictEqual([
      "data/old.ts",
      "data/zones.ts",
      "src/parse.ts",
      "test/parse.test.ts",
      "README.md",
    ]);
    expect(["b", "a/z", "a/b/c"].toSorted(treeOrder)).toStrictEqual([
      "a/b/c",
      "a/z",
      "b",
    ]);
  });

  it("start folded when added or deleted past 80 lines", () => {
    expect(
      drawnFiles(files)
        .filter(({ folded }) => folded)
        .map(({ file }) => file.path)
    ).toStrictEqual(["data/zones.ts"]);
  });

  it("count by path: the ask's territory, its tests, the rest", () => {
    const stats = statsOf(drawnFiles(files), ["src/**"]);

    expect([stats.files, stats.additions, stats.deletions]).toStrictEqual([
      5, 85, 81,
    ]);
    expect(stats.parts).toStrictEqual([
      { additions: 2, deletions: 1, files: 1, label: "territory" },
      { additions: 1, deletions: 0, files: 1, label: "tests" },
      { additions: 82, deletions: 80, files: 3, label: "other" },
    ]);
  });

  it("read a territory's globs as git paths", () => {
    expect(globTest("src/**")("src/a/b.ts")).toBeTruthy();
    expect(globTest("src/*.ts")("src/a/b.ts")).toBeFalsy();
    expect(globTest("packages/parse")("packages/parse/index.ts")).toBeTruthy();
    expect(globTest("**/*.ts")("a.ts")).toBeTruthy();
  });

  it("know a test file by its folder or its name", () => {
    expect(isTestPath("src/parse.test.ts")).toBeTruthy();
    expect(isTestPath("test/asks/x.ts")).toBeTruthy();
    expect(isTestPath("src/testing.ts")).toBeFalsy();
  });
});

describe("the keys between files", () => {
  const paths = ["a.ts", "b.ts", "c.ts"];

  it("move from the page's own file, and stop at either end", () => {
    expect(stepFrom(paths, "b.ts", 1)).toBe("c.ts");
    expect(stepFrom(paths, "b.ts", -1)).toBe("a.ts");
    expect(stepFrom(paths, "c.ts", 1)).toBe("c.ts");
    expect(stepFrom(paths, "a.ts", -1)).toBe("a.ts");
  });

  it("start at the first file, or the last going back, from none", () => {
    expect(stepFrom(paths, undefined, 1)).toBe("a.ts");
    expect(stepFrom(paths, undefined, -1)).toBe("c.ts");
    expect(stepFrom([], undefined, 1)).toBeUndefined();
  });
});
