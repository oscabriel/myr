/**
 * A project's tags in the order a reader meets them: tags that version no
 * package first, then each package's tags as one run, the package with the
 * most tags first, newest first within a run. A monorepo's main package
 * (changesets' `@changesets/cli`) then sits on the first page, not several
 * pages in behind every one-tag package.
 */
import { describe, expect, it } from "@effect/vitest";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { packageOf } from "@repo/protocol/domain/code";
import { ProjectName, RepoName } from "@repo/protocol/ids";
import { Effect, Option } from "effect";

import { refsOf } from "../src/code.ts";
import type { CodeProject } from "../src/code.ts";
import { sortTags } from "../src/code/refs.ts";
import { writer } from "./code-fixtures.ts";

/** Changesets' kinds of tag, shuffled: plain, scoped and unscoped. */
const shuffled = [
  "get-workspaces@1.0.11",
  "@changesets/cli@2.27.1",
  "@changesets/cli@2.3.0",
  "@changesets/cli@2.29.0",
  "@changesets/apply@1.0.0",
  "v2.0.0",
  "v1.10.0-beta.1",
  "v1.10.0",
];

/** The order a reader meets them in. */
const ordered = [
  "v2.0.0",
  "v1.10.0",
  "v1.10.0-beta.1",
  "@changesets/cli@2.29.0",
  "@changesets/cli@2.27.1",
  "@changesets/cli@2.3.0",
  "@changesets/apply@1.0.0",
  "get-workspaces@1.0.11",
];

const named = (names: readonly string[]) => names.map((name) => ({ name }));

describe("a tag's package", () => {
  it("is the name before its last at sign, a scope's included", () => {
    expect(packageOf("@changesets/cli@2.27.1")).toStrictEqual(
      Option.some("@changesets/cli")
    );
    expect(packageOf("get-workspaces@1.0.11")).toStrictEqual(
      Option.some("get-workspaces")
    );
    expect(packageOf("@scope@1")).toStrictEqual(Option.some("@scope"));
  });

  it("is none for a version alone or a scope with no version", () => {
    expect(packageOf("v1.2.3")).toStrictEqual(Option.none());
    expect(packageOf("1.0.0")).toStrictEqual(Option.none());
    expect(packageOf("@scope")).toStrictEqual(Option.none());
  });
});

describe("a project's tags", () => {
  it("list the plain tags, then each package's run, the most tags first, then by name, each newest first", () => {
    expect(sortTags(named(shuffled))).toStrictEqual(named(ordered));
  });

  it("keep each tag whole, whatever else it carries", () => {
    const tags = [
      { name: "pkg@1.0.0", sha: "one" },
      { name: "v1.0.0", sha: "two" },
    ];

    expect(sortTags(tags)).toStrictEqual([
      { name: "v1.0.0", sha: "two" },
      { name: "pkg@1.0.0", sha: "one" },
    ]);
  });

  it.effect("come from a repo's refs in that order", () =>
    Effect.gen(function* () {
      const git = yield* writer;
      const root = yield* git.commit("Start", [], [], 1);
      const repo = RepoName.make("changesets");

      yield* git.push(repo, [
        ["refs/heads/main", root],
        ...shuffled.map((name) => [`refs/tags/${name}`, root] as const),
      ]);

      const code: CodeProject = {
        forks: Effect.succeed([]),
        head: Effect.succeedNone,
        landings: () => Effect.succeed([]),
        project: ProjectName.make("changesets"),
        repo,
      };

      const { tags } = yield* refsOf(code);

      expect(tags.map(({ name }) => name)).toStrictEqual(ordered);
    }).pipe(Effect.provide(RepoHostMemory))
  );
});
