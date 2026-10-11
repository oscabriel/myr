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
  ["alice_datekit", RepoKind.Canonical({ project: datekit })],
  // A project made before owners keeps its flat key (ADR 0032).
  [
    "datekit",
    RepoKind.Canonical({ project: ProjectName.make("oscabriel/datekit") }),
  ],
  [
    "alice_date-kit",
    RepoKind.Canonical({ project: ProjectName.make("alice/date-kit") }),
  ],
  // A bare key no project has names nothing.
  ["date-kit", RepoKind.Unknown()],
  [
    "alice_datekit--parse-iso--bob",
    RepoKind.ClaimFork({
      ask: parseIso,
      handle: Handle.make("bob"),
      project: datekit,
    }),
  ],
  [
    "alice_datekit--me--alice",
    RepoKind.WorkingFork({ handle: Handle.make("alice"), project: datekit }),
  ],
  // `layer` is no ask's name; a layer's repo is the visibility cartridge's.
  ["alice_datekit--layer--alice", RepoKind.Unknown()],
  ["alice_datekit--maintainers", RepoKind.Unknown()],
  // A stray `--` splits a name into parts no repo has.
  ["alice_datekit--parse-iso--bob--extra", RepoKind.Unknown()],
  ["alice_datekit----bob", RepoKind.Unknown()],
  ["alice_datekit---parse-iso--bob", RepoKind.Unknown()],
  ["alice_datekit--parse-iso--", RepoKind.Unknown()],
  ["--datekit", RepoKind.Unknown()],
  // The platform spells every handle in a name in lowercase.
  ["alice_datekit--parse-iso--Bob", RepoKind.Unknown()],
  // Not a project's name at all.
  ["Datekit", RepoKind.Unknown()],
  ["datekit.git", RepoKind.Unknown()],
];

describe("what a repo's name says it is", () => {
  it.each(kinds)("%s", (name, kind) => {
    expect(repoKind(RepoName.make(name))).toStrictEqual(kind);
  });

  it("names a claim's fork with its claimant's handle in lowercase, and reads it back", () => {
    const fork = claimForkName(datekit, parseIso, Handle.make("Bob"));

    expect(fork).toBe("alice_datekit--parse-iso--bob");
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

    expect(fork).toBe("alice_datekit--me--alice");
    expect(repoKind(fork)).toStrictEqual(
      RepoKind.WorkingFork({ handle: Handle.make("alice"), project: datekit })
    );
  });
});
