import { ObjectId, RepoHost } from "@repo/artifacts/repo-host";
import type { RepoNotFound, TreeEntry } from "@repo/artifacts/repo-host";
import { BlobSha, RepoPath } from "@repo/protocol/ids";
import type { RepoName, TreeSha } from "@repo/protocol/ids";
import { Array, Effect, Option, Order, Semaphore } from "effect";

import { Edit, sharedEnds, shortestDiff } from "./line-diff.ts";

/** The same shape as the gate's `Change` (`@repo/gate/facts`), which git cannot import. */
export interface Change {
  readonly path: RepoPath;
  readonly status: "added" | "modified" | "deleted";
  readonly before?: BlobSha;
  readonly after?: BlobSha;
}

export interface AddedLine {
  readonly line: number;
  readonly text: string;
}

// Store calls under way at once, however deep the walk or long the change set.
const STORE_CALLS = 8;

// The walk forks freely; the semaphore alone holds the store to its calls.
const ALL = { concurrency: "unbounded" } as const;

const entriesOf = (
  calls: Semaphore.Semaphore,
  repo: RepoName,
  tree: Option.Option<string>
) =>
  Option.match(tree, {
    onNone: () => Effect.succeed<readonly TreeEntry[]>([]),
    onSome: (id) =>
      RepoHost.use((host) => host.readTree(repo, ObjectId.make(id))).pipe(
        Semaphore.withPermit(calls),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.die(`${repo} has no tree ${id}`),
            onSome: Effect.succeed,
          })
        )
      ),
  });

const treeIdOf = (entry: TreeEntry | undefined) =>
  entry?.type === "tree" ? Option.some(entry.sha) : Option.none();

// A submodule's pointer counts as a file at its path, so a change to it is seen.
const fileIdOf = (entry: TreeEntry | undefined) =>
  entry === undefined || entry.type === "tree"
    ? undefined
    : BlobSha.make(entry.sha);

const fileChange = (
  path: string,
  before: BlobSha | undefined,
  after: BlobSha | undefined
): readonly Change[] => {
  const at = RepoPath.make(path);

  if (before !== undefined && after !== undefined) {
    return [{ after, before, path: at, status: "modified" }];
  }

  if (before !== undefined) {
    return [{ before, path: at, status: "deleted" }];
  }

  return after === undefined ? [] : [{ after, path: at, status: "added" }];
};

const walk = (
  calls: Semaphore.Semaphore,
  repo: RepoName,
  prefix: string,
  base: Option.Option<string>,
  head: Option.Option<string>
): Effect.Effect<readonly Change[], RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const [before, after] = yield* Effect.all(
      [entriesOf(calls, repo, base), entriesOf(calls, repo, head)],
      ALL
    );

    const beforeByName = new Map(before.map((entry) => [entry.name, entry]));
    const afterByName = new Map(after.map((entry) => [entry.name, entry]));

    // The same id and mode: nothing under it changed, so it is never read.
    const names = Array.sort(
      new Set([...beforeByName.keys(), ...afterByName.keys()]),
      Order.String
    ).filter((name) => {
      const old = beforeByName.get(name);
      const next = afterByName.get(name);

      return old?.sha !== next?.sha || old?.mode !== next?.mode;
    });

    const changed = yield* Effect.forEach(
      names,
      (name) => {
        const old = beforeByName.get(name);
        const next = afterByName.get(name);
        const path = `${prefix}${name}`;
        const files = fileChange(path, fileIdOf(old), fileIdOf(next));
        const inside = [treeIdOf(old), treeIdOf(next)] as const;

        return Option.isNone(inside[0]) && Option.isNone(inside[1])
          ? Effect.succeed(files)
          : walk(calls, repo, `${path}/`, inside[0], inside[1]).pipe(
              Effect.map((nested) => [...files, ...nested])
            );
      },
      ALL
    );

    return changed.flat();
  });

/** Descends only into subtrees whose ids differ: the store has no diff of its own. */
export const treeDiff = (
  repo: RepoName,
  base: TreeSha,
  head: TreeSha
): Effect.Effect<readonly Change[], RepoNotFound, RepoHost> =>
  Effect.flatMap(Semaphore.make(STORE_CALLS), (calls) =>
    walk(calls, repo, "", Option.some(base), Option.some(head))
  );

// git's own test: a NUL among the first bytes means the blob is not text.
const SNIFF = 8192;

const isBinary = (bytes: Uint8Array) => bytes.subarray(0, SNIFF).includes(0);

const linesOf = (bytes: Uint8Array) => {
  const text = new TextDecoder().decode(bytes);
  const lines = text.split("\n");

  if (text.endsWith("\n")) {
    lines.pop();
  }

  return lines;
};

const unmatched = (previous: readonly string[], next: readonly string[]) => {
  const left = new Map<string, number>();

  for (const line of previous) {
    left.set(line, (left.get(line) ?? 0) + 1);
  }

  return next.flatMap((line, index) => {
    const count = left.get(line) ?? 0;

    left.set(line, count - 1);

    return count > 0 ? [] : [index];
  });
};

const added = (
  previous: readonly string[],
  next: readonly string[]
): readonly AddedLine[] =>
  Option.match(shortestDiff(previous, next), {
    onNone: () => {
      const { head, tail } = sharedEnds(previous, next);

      return unmatched(
        previous.slice(head, previous.length - tail),
        next.slice(head, next.length - tail)
      ).map((index) => head + index);
    },
    onSome: (edits) =>
      edits.flatMap((edit) =>
        Edit.$is("Insert")(edit)
          ? Array.makeBy(edit.count, (at) => edit.newStart + at)
          : []
      ),
  }).map((index) => ({ line: index + 1, text: next[index] ?? "" }));

const textOf = (repo: RepoName, blob: BlobSha | undefined) =>
  blob === undefined
    ? Effect.succeedSome<readonly string[]>([])
    : RepoHost.use((host) => host.readBlob(repo, ObjectId.make(blob))).pipe(
        Effect.map(
          Option.flatMap((bytes) =>
            isBinary(bytes) ? Option.none() : Option.some(linesOf(bytes))
          )
        )
      );

// Changes diffed at once, each reading its two blobs together: eight store
// calls, and no more than four files' text held at a time.
const CHANGES = { concurrency: STORE_CALLS / 2 } as const;

export const addedLines = (
  repo: RepoName,
  changes: readonly Change[]
): Effect.Effect<
  ReadonlyMap<RepoPath, readonly AddedLine[]>,
  RepoNotFound,
  RepoHost
> =>
  Effect.forEach(
    changes.filter((change) => change.after !== undefined),
    (change) =>
      Effect.gen(function* () {
        const [previous, next] = yield* Effect.all(
          [textOf(repo, change.before), textOf(repo, change.after)],
          ALL
        );

        const lines = Option.match(next, {
          onNone: () => [],
          onSome: (text) =>
            added(
              Option.getOrElse(previous, () => []),
              text
            ),
        });

        return [change.path, lines] as const;
      }),
    CHANGES
  ).pipe(Effect.map((entries) => new Map(entries)));
