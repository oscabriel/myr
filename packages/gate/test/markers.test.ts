import { describe, expect, it } from "@effect/vitest";
import { RepoPath } from "@repo/protocol/ids";
import { Option } from "effect";

import { defaultMarkers, findMarkers } from "../src/markers.ts";
import { addedLines } from "./facts.ts";

const at = (path: string, line: number) => ({
  line,
  path: RepoPath.make(path),
});

// One added line per default marker in spec §4.2, as each tool writes it.
const lines: readonly (readonly [string, string])[] = [
  [".skip(", '  it.skip("parses week 53", () => {'],
  [".only(", '  describe.only("weeks", () => {'],
  [".todo(", '  it.todo("parses week 54");'],
  ["eslint-disable", "/* eslint-disable no-console */"],
  ["oxlint-disable", "// oxlint-disable-next-line no-explicit-any"],
  ["biome-ignore", "// biome-ignore lint/style: generated"],
  ["@ts-ignore", "// @ts-ignore"],
  ["@ts-expect-error", "// @ts-expect-error"],
  ["@ts-nocheck", "// @ts-nocheck"],
  ["@effect-diagnostics", "// @effect-diagnostics-next-line"],
  ["# noqa", "import os  # noqa"],
  ["# type: ignore", "x = parse(y)  # type: ignore"],
  ["#[allow(", "#[allow(dead_code)]"],
  ["//nolint", "func parse() { //nolint"],
  ["istanbul ignore", "/* istanbul ignore next */"],
  ["c8 ignore", "/* c8 ignore next */"],
];

describe(findMarkers, () => {
  it.each(lines)("finds %s where a tool writes it", (marker, text) => {
    const hits = findMarkers(defaultMarkers, addedLines(["src/x.ts", 5, text]));

    expect(hits.map((hit) => hit.marker)).toContain(marker);
  });

  it("finds a marker in any file, a README's prose included", () => {
    const hits = findMarkers(
      defaultMarkers,
      addedLines(["README.md", 40, "Run `it.only(` to focus a test."])
    );

    expect(hits).toStrictEqual([
      { at: at("README.md", 40), marker: ".only(", reason: Option.none() },
    ]);
  });

  it("reads the reason after ` -- `, without the comment's closer", () => {
    const hits = findMarkers(
      defaultMarkers,
      addedLines(
        ["src/a.ts", 1, "// oxlint-disable-next-line no-x -- reason given"],
        ["src/a.ts", 2, "/* eslint-disable no-y -- generated code */"],
        ["src/a.ts", 3, "// @ts-expect-error -- "],
        ["src/a.ts", 4, "it.skip(--flag)"]
      )
    );

    expect(hits.map((hit) => hit.reason)).toStrictEqual([
      Option.some("reason given"),
      Option.some("generated code"),
      Option.none(),
      Option.none(),
    ]);
  });

  it("orders what it finds by path, then line", () => {
    const hits = findMarkers(
      defaultMarkers,
      addedLines(
        ["src/b.ts", 9, "it.only("],
        ["src/b.ts", 3, "it.skip("],
        ["src/a.ts", 7, "// @ts-ignore"]
      )
    );

    expect(hits.map((hit) => hit.at)).toStrictEqual([
      at("src/a.ts", 7),
      at("src/b.ts", 3),
      at("src/b.ts", 9),
    ]);
  });
});
