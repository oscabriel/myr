import { describe, expect, it } from "@effect/vitest";
import { AskId, Handle, ProjectName, RepoName } from "@repo/protocol/ids";

import {
  claimForkName,
  RepoKind,
  repoKind,
  workingForkName,
} from "../src/repo-names.ts";

const datekit = ProjectName.make("alice/datekit");

const parseIso = AskId.make("parse-iso");

const kinds: readonly (readonly [string, RepoKind])[] = [
  ["alice__datekit", RepoKind.Canonical({ project: datekit })],
  [
    "datekit",
    RepoKind.Canonical({ project: ProjectName.make("oscabriel/datekit") }),
  ],
  [
    "alice__date-kit",
    RepoKind.Canonical({ project: ProjectName.make("alice/date-kit") }),
  ],
  ["date-kit", RepoKind.Unknown()],
  [
    "alice__datekit--parse-iso--bob",
    RepoKind.ClaimFork({
      ask: parseIso,
      handle: Handle.make("bob"),
      project: datekit,
    }),
  ],
  [
    "alice__datekit--me--alice",
    RepoKind.WorkingFork({ handle: Handle.make("alice"), project: datekit }),
  ],
  ["alice__datekit--layer--alice", RepoKind.Unknown()],
  ["alice__datekit--maintainers", RepoKind.Unknown()],
  ["alice__datekit--parse-iso--bob--extra", RepoKind.Unknown()],
  ["alice__datekit----bob", RepoKind.Unknown()],
  ["alice__datekit---parse-iso--bob", RepoKind.Unknown()],
  ["alice__datekit--parse-iso--", RepoKind.Unknown()],
  ["--datekit", RepoKind.Unknown()],
  ["alice__datekit--parse-iso--Bob", RepoKind.Unknown()],
  ["Datekit", RepoKind.Unknown()],
  ["datekit.git", RepoKind.Unknown()],
];

describe("what a repo's name says it is", () => {
  it.each(kinds)("%s", (name, kind) => {
    expect(repoKind(RepoName.make(name))).toStrictEqual(kind);
  });

  it("names a claim's fork with its claimant's handle in lowercase, and reads it back", () => {
    const fork = claimForkName(datekit, parseIso, Handle.make("Bob"));

    expect(fork).toBe("alice__datekit--parse-iso--bob");
    expect(repoKind(fork)).toStrictEqual(
      RepoKind.ClaimFork({
        ask: parseIso,
        handle: Handle.make("bob"),
        project: datekit,
      })
    );
  });

  it("names a person's working fork with their handle in lowercase, and reads it back", () => {
    const fork = workingForkName(datekit, Handle.make("Alice"));

    expect(fork).toBe("alice__datekit--me--alice");
    expect(repoKind(fork)).toStrictEqual(
      RepoKind.WorkingFork({ handle: Handle.make("alice"), project: datekit })
    );
  });
});
