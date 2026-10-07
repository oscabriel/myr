import { describe, expect, it } from "@effect/vitest";
import { RepoPath } from "@repo/protocol/ids";
import { Option } from "effect";

import { defaultMarkers, markersOf, scanMarkers } from "../src/markers.ts";
import { addedLines, policy } from "./facts.ts";

const texts = defaultMarkers.map((marker) => marker.text);

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

describe(markersOf, () => {
  it("starts from the spec's default list, each marker with the kind of check it turns off", () => {
    expect(
      defaultMarkers.map(({ family, text }) => `${family} ${text}`)
    ).toStrictEqual([
      "test .skip(",
      "test .only(",
      "test .todo(",
      "lint eslint-disable",
      "lint oxlint-disable",
      "lint biome-ignore",
      "types @ts-ignore",
      "types @ts-expect-error",
      "types @ts-nocheck",
      "effect @effect-diagnostics",
      "python # noqa",
      "python # type: ignore",
      "rust #[allow(",
      "go //nolint",
      "coverage istanbul ignore",
      "coverage c8 ignore",
    ]);
  });

  it("adds the markers a project adds to the defaults, each once", () => {
    expect(
      markersOf({
        ...policy,
        weakening: { markers: ["vi.mock(", ".skip("] },
      })
    ).toStrictEqual([...texts, "vi.mock("]);
  });
});

describe(scanMarkers, () => {
  it.each(lines)("finds %s where a tool writes it", (marker, text) => {
    const hits = scanMarkers(addedLines(["src/x.ts", 5, text]), texts);

    expect(hits.map((hit) => hit.marker)).toContain(marker);
  });

  it("finds a marker in any file, a README's prose included", () => {
    const hits = scanMarkers(
      addedLines(["README.md", 40, "Run `it.only(` to focus a test."]),
      texts
    );

    expect(hits).toStrictEqual([
      {
        line: 40,
        marker: ".only(",
        path: RepoPath.make("README.md"),
        reason: Option.none(),
      },
    ]);
  });

  it("reads the reason after ` -- `, without the comment's closer", () => {
    const hits = scanMarkers(
      addedLines(
        ["src/a.ts", 1, "// oxlint-disable-next-line no-x -- reason given"],
        ["src/a.ts", 2, "/* eslint-disable no-y -- generated code */"],
        ["src/a.ts", 3, "// @ts-expect-error -- "],
        ["src/a.ts", 4, "it.skip(--flag)"]
      ),
      texts
    );

    expect(hits.map((hit) => hit.reason)).toStrictEqual([
      Option.some("reason given"),
      Option.some("generated code"),
      Option.none(),
      Option.none(),
    ]);
  });

  it("orders what it finds by path, then line", () => {
    const hits = scanMarkers(
      addedLines(
        ["src/b.ts", 9, "it.only("],
        ["src/b.ts", 3, "it.skip("],
        ["src/a.ts", 7, "// @ts-ignore"]
      ),
      texts
    );

    expect(hits.map(({ line, path }) => `${path}:${line}`)).toStrictEqual([
      "src/a.ts:7",
      "src/b.ts:3",
      "src/b.ts:9",
    ]);
  });
});
