import { describe, expect, it } from "@effect/vitest";
import * as Ids from "@repo/protocol/ids";
import { Schema } from "effect";

import { BranchName, RepoName } from "../src/repo-host.ts";

// One `RepoName` across the product: the port names repos with the domain's.
describe("a repo name", () => {
  it("is the domain's RepoName", () => {
    expect(RepoName).toBe(Ids.RepoName);
  });
});

// Artifacts' binding resolves short branch names and commit ids only,
// so a full ref name cannot be a revision.
describe("a branch revision", () => {
  it.each(["main", "feature/parser", "asked-landed"])("takes %s", (name) => {
    expect(Schema.is(BranchName)(name)).toBeTruthy();
  });

  it.each(["refs/heads/main", "refs/asked/landed", "refs/notes/commits", ""])(
    "refuses %j",
    (name) => {
      expect(Schema.is(BranchName)(name)).toBeFalsy();
    }
  );
});
