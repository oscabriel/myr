import { describe, expect, it } from "@effect/vitest";
import { CommitSha } from "@repo/protocol/ids";

import { blame } from "../src/blame.ts";

const v1 = CommitSha.make("1".repeat(40));

const v2 = CommitSha.make("2".repeat(40));

const v3 = CommitSha.make("3".repeat(40));

describe(blame, () => {
  it("gives each line to the version that brought it", () => {
    expect(
      blame([
        { sha: v3, text: "a\nx\nb\nz\n" },
        { sha: v2, text: "a\nx\nb\nc\n" },
        { sha: v1, text: "a\nb\nc\n" },
      ])
    ).toStrictEqual({
      ranges: [
        { end: 1, sha: v1, start: 1 },
        { end: 2, sha: v2, start: 2 },
        { end: 3, sha: v1, start: 3 },
        { end: 4, sha: v3, start: 4 },
      ],
      reachedEnd: true,
    });
  });

  it("gives one version every line, as one range", () => {
    expect(blame([{ sha: v1, text: "a\nb\nc" }])).toStrictEqual({
      ranges: [{ end: 3, sha: v1, start: 1 }],
      reachedEnd: true,
    });
  });

  it("gives an empty file no ranges", () => {
    expect(
      blame([
        { sha: v2, text: "" },
        { sha: v1, text: "a\n" },
      ])
    ).toStrictEqual({ ranges: [], reachedEnd: false });
  });

  it("has not reached the end when the oldest version keeps no line", () => {
    expect(
      blame([
        { sha: v2, text: "new\n" },
        { sha: v1, text: "old\n" },
      ])
    ).toStrictEqual({
      ranges: [{ end: 1, sha: v2, start: 1 }],
      reachedEnd: false,
    });
  });
});
