import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { forkAddressOf, ForkPoint, forkRev } from "../src/domain/code.ts";
import { AskId, CommitSha, Handle } from "../src/ids.ts";

const bob = { ask: AskId.make("parse-iso"), handle: Handle.make("bob") };

const sha = CommitSha.make("a".repeat(40));

describe("a fork address", () => {
  it("names a fork's main, a branch, or a commit by claimant and ask", () => {
    expect(
      [
        "@bob/parse-iso",
        "@bob/parse-iso:main",
        "@bob/parse-iso:fix/tz",
        `@bob/parse-iso:${sha}`,
      ].map(forkAddressOf)
    ).toStrictEqual([
      Option.some({ ...bob, point: ForkPoint.Branch({ name: "main" }) }),
      Option.some({ ...bob, point: ForkPoint.Branch({ name: "main" }) }),
      Option.some({ ...bob, point: ForkPoint.Branch({ name: "fix/tz" }) }),
      Option.some({ ...bob, point: ForkPoint.Commit({ sha }) }),
    ]);
  });

  it("is written back as the text it was read from", () => {
    const written = [
      forkRev(bob),
      forkRev(bob, "main"),
      forkRev(bob, "fix/tz"),
      forkRev(bob, sha),
    ];

    expect(written).toStrictEqual([
      "@bob/parse-iso",
      "@bob/parse-iso",
      "@bob/parse-iso:fix/tz",
      `@bob/parse-iso:${sha}`,
    ]);
    expect(
      written.map((rev) => Option.isSome(forkAddressOf(rev)))
    ).toStrictEqual([true, true, true, true]);
  });

  it("reads nothing else: a ref path, a repo's name, a tag, or a reserved ask", () => {
    const refused = [
      "main",
      "v1.0.0",
      "@datekit/core@2.0.0",
      "alice__datekit--parse-iso--bob",
      "alice__datekit--layer--secrets",
      "@bob/layer",
      "@bob/me",
      "@bob/Parse-ISO",
      "@-bob/parse-iso",
      "@bob/parse-iso/more",
      "@bob/parse-iso:",
      "@bob/parse-iso:refs/heads/main",
      "@bob/parse-iso:../main",
      "@bob/parse-iso:a//b",
      "@bob/parse-iso:main:main",
      "@bob",
      "bob/parse-iso",
    ];

    expect(
      refused.filter((rev) => Option.isSome(forkAddressOf(rev)))
    ).toStrictEqual([]);
  });
});
