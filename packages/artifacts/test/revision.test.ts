import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { BranchName } from "../src/repo-host.ts";

// Artifacts' binding resolves short branch names and commit ids only (S1 #20),
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
