import { describe, expect, it } from "@effect/vitest";
import { BlobSha, RepoPath } from "@repo/protocol/ids";
import { Effect } from "effect";

import { patchId } from "../src/patch-id.ts";
import type { Change } from "../src/tree-diff.ts";

const blob = (digit: string) => BlobSha.make(digit.repeat(40));

const modified: Change = {
  after: blob("2"),
  before: blob("1"),
  path: RepoPath.make("src/a.ts"),
  status: "modified",
};

const added: Change = {
  after: blob("3"),
  path: RepoPath.make("src/b.ts"),
  status: "added",
};

const deleted: Change = {
  before: blob("4"),
  path: RepoPath.make("docs/x.md"),
  status: "deleted",
};

describe("an answer's patch id", () => {
  it.effect("is SHA-256 over the sorted (path, before, after) lines", () =>
    Effect.gen(function* () {
      // `printf 'src/a.ts\0<1×40>\0<2×40>\nsrc/b.ts\0\0<3×40>\n' | sha256sum`
      expect(yield* patchId([added, modified])).toBe(
        "41cf8262f0d7d26011b85d7576fb81865b70e05c5f5d0668b6420045d3b1091d"
      );
    })
  );

  it.effect("is the same for the same change set in any order", () =>
    Effect.gen(function* () {
      const one = yield* patchId([modified, added, deleted]);

      expect(yield* patchId([deleted, modified, added])).toBe(one);
      expect(yield* patchId([added, deleted, modified])).toBe(one);
      expect(one).toMatch(/^[0-9a-f]{64}$/u);
    })
  );

  it.effect("moves when one file's new blob moves", () =>
    Effect.gen(function* () {
      const one = yield* patchId([modified, added]);

      expect(
        yield* patchId([{ ...modified, after: blob("5") }, added])
      ).not.toBe(one);
    })
  );
});
