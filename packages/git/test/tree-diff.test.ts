import { describe, expect, it } from "@effect/vitest";
import {
  ObjectId,
  RefName,
  RepoHost,
  RepoName,
} from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { BlobSha, RepoPath, TreeSha } from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import { gitClient } from "@repo/testkit/git-client";
import type { Files } from "@repo/testkit/git-client";
import { Effect, Layer, Option, Ref } from "effect";

import { addedLines, treeDiff } from "../src/tree-diff.ts";

const repo = RepoName.make("demo");

const main = RefName.make("refs/heads/main");

const before: Files = [
  ["README.md", "demo\n"],
  ["docs/x.md", "gone soon\n"],
  ["lib/kept.ts", "export const kept = 1;\n"],
  ["src/a.ts", "one\ntwo\nthree\nfour\n"],
];

const after: Files = [
  ["README.md", "demo\n"],
  ["assets/logo.bin", "\u0000PNG\nline\n"],
  ["lib/kept.ts", "export const kept = 1;\n"],
  ["src/a.ts", "one\nbetween\ntwo\nthree\nFOUR\nfive\n"],
  ["src/b/c.ts", "export const c = 3;\n"],
];

/** The memory store, with each tree id `readTree` is asked for written to `reads`. */
const countedBy = (reads: Ref.Ref<readonly string[]>) =>
  Layer.effect(
    RepoHost,
    Effect.gen(function* () {
      const host = yield* RepoHost;

      return RepoHost.of({
        ...host,
        readTree: (name, tree) =>
          Ref.update(reads, (all) => [...all, tree]).pipe(
            Effect.andThen(host.readTree(name, tree))
          ),
      });
    })
  ).pipe(Layer.provide(RepoHostMemory));

/** Two commits in `demo`, and the ids of their trees and blobs as git wrote them. */
const twoCommits = Effect.gen(function* () {
  const repos = yield* RepoHost;
  const client = yield* gitClient(memoryFs());
  const first = yield* client.commit("before", before);
  const second = yield* client.commit("after", after, [first]);

  yield* repos.create(repo);
  yield* repos.push(repo, client.source, [
    { from: Option.none(), ref: main, to: second },
  ]);

  const treeOf = (sha: CommitSha) =>
    repos.readCommit(repo, sha).pipe(
      Effect.map(Option.getOrThrow),
      Effect.map(({ tree }) => TreeSha.make(tree))
    );

  /** The id of the entry at `path` under `root`. */
  const idAt = (root: string, path: string): Effect.Effect<string> =>
    Effect.gen(function* () {
      const [head = "", ...rest] = path.split("/");

      const entries = yield* repos
        .readTree(repo, ObjectId.make(root))
        .pipe(Effect.orDie, Effect.map(Option.getOrThrow));

      const entry = entries.find(({ name }) => name === head);

      if (entry === undefined) {
        return yield* Effect.die(`no ${path}`);
      }

      return rest.length === 0
        ? entry.sha
        : yield* idAt(entry.sha, rest.join("/"));
    });

  const base = yield* treeOf(first);
  const head = yield* treeOf(second);

  return {
    base,
    blob: (tree: TreeSha, path: string) =>
      idAt(tree, path).pipe(Effect.map((id) => BlobSha.make(id))),
    head,
    tree: (tree: TreeSha, path: string) => idAt(tree, path),
  };
});

/** Lines from a three-word alphabet, from a fixed seed (Park and Miller's generator). */
const randomFiles = (cases: number) => {
  let state = 20_261_007;

  const next = (below: number) => {
    state = (state * 16_807) % 2_147_483_647;

    return state % below;
  };

  const file = () =>
    Array.from({ length: next(9) }, () => ["a", "b", "c"][next(3)] ?? "a");

  return Array.from({ length: cases }, () => [file(), file()] as const);
};

/** The length of a longest common subsequence, by the textbook table. */
const lcs = (one: readonly string[], other: readonly string[]) => {
  const table = Array.from({ length: one.length + 1 }, () =>
    Array.from({ length: other.length + 1 }, () => 0)
  );

  for (let i = 1; i <= one.length; i += 1) {
    for (let j = 1; j <= other.length; j += 1) {
      const row = table[i] ?? [];

      row[j] =
        one[i - 1] === other[j - 1]
          ? (table[i - 1]?.[j - 1] ?? 0) + 1
          : Math.max(table[i - 1]?.[j] ?? 0, row[j - 1] ?? 0);
    }
  }

  return table[one.length]?.[other.length] ?? 0;
};

const text = (lines: readonly string[]) =>
  lines.map((line) => `${line}\n`).join("");

const isSubsequence = (part: readonly string[], whole: readonly string[]) => {
  let found = 0;

  for (const line of whole) {
    if (line === part[found]) {
      found += 1;
    }
  }

  return found === part.length;
};

describe("the changes between two trees", () => {
  it.effect("finds each added, modified and deleted file with its blobs", () =>
    Effect.gen(function* () {
      const { base, blob, head } = yield* twoCommits;
      const changes = yield* treeDiff(repo, base, head);

      expect(
        changes.toSorted((one, other) => one.path.localeCompare(other.path))
      ).toStrictEqual([
        {
          after: yield* blob(head, "assets/logo.bin"),
          path: RepoPath.make("assets/logo.bin"),
          status: "added",
        },
        {
          before: yield* blob(base, "docs/x.md"),
          path: RepoPath.make("docs/x.md"),
          status: "deleted",
        },
        {
          after: yield* blob(head, "src/a.ts"),
          before: yield* blob(base, "src/a.ts"),
          path: RepoPath.make("src/a.ts"),
          status: "modified",
        },
        {
          after: yield* blob(head, "src/b/c.ts"),
          path: RepoPath.make("src/b/c.ts"),
          status: "added",
        },
      ]);
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("never reads a subtree whose id did not change", () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make<readonly string[]>([]);

      yield* Effect.gen(function* () {
        const { base, head, tree } = yield* twoCommits;
        const kept = yield* tree(head, "lib");

        expect(yield* tree(base, "lib")).toBe(kept);

        yield* Ref.set(reads, []);
        yield* treeDiff(repo, base, head);

        const read = yield* Ref.get(reads);

        expect(read).toContain(base);
        expect(read).toContain(yield* tree(head, "src"));
        expect(read).not.toContain(kept);
      }).pipe(Effect.provide(countedBy(reads)));
    })
  );

  it.effect("gives a modified file's new lines, numbered in the new file", () =>
    Effect.gen(function* () {
      const { base, head } = yield* twoCommits;
      const lines = yield* addedLines(repo, yield* treeDiff(repo, base, head));

      expect(lines.get(RepoPath.make("src/a.ts"))).toStrictEqual([
        { line: 2, text: "between" },
        { line: 5, text: "FOUR" },
        { line: 6, text: "five" },
      ]);
      expect(lines.get(RepoPath.make("src/b/c.ts"))).toStrictEqual([
        { line: 1, text: "export const c = 3;" },
      ]);
      expect(lines.get(RepoPath.make("assets/logo.bin"))).toStrictEqual([]);
      expect([...lines.keys()]).not.toContain(RepoPath.make("docs/x.md"));
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "keeps a longest common run of lines and calls only the rest added",
    () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient(memoryFs());

        const cases = yield* Effect.forEach(
          randomFiles(60),
          ([previous, next], index) =>
            Effect.gen(function* () {
              const name = RepoName.make(`case-${index}`);

              const first = yield* client.commit("before", [
                ["f.txt", text(previous)],
              ]);

              const second = yield* client.commit(
                "after",
                [["f.txt", text(next)]],
                [first]
              );

              yield* repos.create(name);
              yield* repos.push(name, client.source, [
                { from: Option.none(), ref: main, to: second },
              ]);

              const treeOf = (sha: CommitSha) =>
                repos
                  .readCommit(name, sha)
                  .pipe(
                    Effect.map((commit) =>
                      TreeSha.make(Option.getOrThrow(commit).tree)
                    )
                  );

              const changes = yield* treeDiff(
                name,
                yield* treeOf(first),
                yield* treeOf(second)
              );

              const lines = yield* addedLines(name, changes);

              const fresh = new Set(
                (lines.get(RepoPath.make("f.txt")) ?? []).map(
                  ({ line }) => line
                )
              );

              const kept = next.filter((_, at) => !fresh.has(at + 1));

              return {
                kept: kept.length,
                longest: lcs(previous, next),
                pair: `${previous.join("")} -> ${next.join("")}`,
                subsequence: isSubsequence(kept, previous),
              };
            })
        );

        // Every case keeps a common subsequence as long as any there is.
        expect(
          cases.filter(
            ({ kept, longest, subsequence }) => !subsequence || kept !== longest
          )
        ).toStrictEqual([]);
      }).pipe(Effect.provide(RepoHostMemory))
  );
});
