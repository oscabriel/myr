import { ObjectId, RepoHost } from "@repo/artifacts/repo-host";
import type { RepoNotFound, TreeEntry } from "@repo/artifacts/repo-host";
import { BlobSha, RepoPath } from "@repo/protocol/ids";
import type { RepoName, TreeSha } from "@repo/protocol/ids";
import { Array, Effect, Option, Order } from "effect";

/**
 * One file an answer changed, with its blob ids before and after. The same
 * shape as the gate's `Change` (`@repo/gate/facts`), which git cannot import.
 */
export interface Change {
  readonly path: RepoPath;
  readonly status: "added" | "modified" | "deleted";
  readonly before?: BlobSha;
  readonly after?: BlobSha;
}

/** A line a change added, numbered from 1 in the new file. */
export interface AddedLine {
  readonly line: number;
  readonly text: string;
}

// Subtrees read at once: each read is a call to the store.
const READS = { concurrency: 8 } as const;

const entriesOf = (repo: RepoName, tree: Option.Option<string>) =>
  Option.match(tree, {
    onNone: () => Effect.succeed<readonly TreeEntry[]>([]),
    onSome: (id) =>
      RepoHost.use((host) => host.readTree(repo, ObjectId.make(id))).pipe(
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
  repo: RepoName,
  prefix: string,
  base: Option.Option<string>,
  head: Option.Option<string>
): Effect.Effect<readonly Change[], RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const [before, after] = yield* Effect.all(
      [entriesOf(repo, base), entriesOf(repo, head)],
      READS
    );

    const beforeByName = new Map(before.map((entry) => [entry.name, entry]));
    const afterByName = new Map(after.map((entry) => [entry.name, entry]));

    const names = Array.sort(
      new Set([...beforeByName.keys(), ...afterByName.keys()]),
      Order.String
    );

    const changed = yield* Effect.forEach(
      names,
      (name) => {
        const old = beforeByName.get(name);
        const next = afterByName.get(name);

        // The same id and mode: nothing under it changed, so it is never read.
        if (old?.sha === next?.sha && old?.mode === next?.mode) {
          return Effect.succeed<readonly Change[]>([]);
        }

        const path = `${prefix}${name}`;
        const files = fileChange(path, fileIdOf(old), fileIdOf(next));
        const inside = [treeIdOf(old), treeIdOf(next)] as const;

        return Option.isNone(inside[0]) && Option.isNone(inside[1])
          ? Effect.succeed(files)
          : walk(repo, `${path}/`, inside[0], inside[1]).pipe(
              Effect.map((nested) => [...files, ...nested])
            );
      },
      READS
    );

    return changed.flat();
  });

/**
 * The files that differ between two trees of `repo`, read through the
 * `RepoHost` port alone: it walks both roots and descends only into subtrees
 * whose ids differ, since the store has no diff of its own.
 */
export const treeDiff = (
  repo: RepoName,
  base: TreeSha,
  head: TreeSha
): Effect.Effect<readonly Change[], RepoNotFound, RepoHost> =>
  walk(repo, "", Option.some(base), Option.some(head));

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

// Past this many edits the diff stops looking for the shortest script.
const MAX_EDITS = 1024;

const at = (values: Int32Array, index: number) => values[index] ?? 0;

/**
 * Indexes in `next` that the edit script ending at `(n, m)` inserts, read
 * back from `trace`, where `trace[d]` holds diagonals `-d..d` after `d` edits.
 */
const insertsFrom = (
  trace: readonly Int32Array[],
  ends: { readonly n: number; readonly m: number }
) => {
  const inserts: number[] = [];
  let x = ends.n;
  let y = ends.m;

  for (let edits = trace.length - 1; edits > 0; edits -= 1) {
    const previous = trace[edits - 1] ?? new Int32Array();
    const diagonal = x - y;

    const reached = (k: number) => at(previous, k + edits - 1);

    const down =
      diagonal === -edits ||
      (diagonal !== edits && reached(diagonal - 1) < reached(diagonal + 1));

    const from = down ? diagonal + 1 : diagonal - 1;

    x = reached(from);
    y = x - from;

    if (down) {
      inserts.push(y);
    }
  }

  return inserts.toReversed();
};

/**
 * Lines of `next` with no partner in `previous`, matched by count: the
 * fallback for a rewrite too large for the shortest script.
 */
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

/**
 * Indexes of the lines of `next` a shortest edit script from `previous`
 * inserts (Myers' O(ND) diff).
 */
const myers = (previous: readonly string[], next: readonly string[]) => {
  const n = previous.length;
  const m = next.length;
  const limit = Math.min(n + m, MAX_EDITS);
  const offset = limit + 1;
  const reach = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];

  for (let edits = 0; edits <= limit; edits += 1) {
    for (let diagonal = -edits; diagonal <= edits; diagonal += 2) {
      let x =
        diagonal === -edits ||
        (diagonal !== edits &&
          at(reach, offset + diagonal - 1) < at(reach, offset + diagonal + 1))
          ? at(reach, offset + diagonal + 1)
          : at(reach, offset + diagonal - 1) + 1;

      let y = x - diagonal;

      while (x < n && y < m && previous[x] === next[y]) {
        x += 1;
        y += 1;
      }

      reach[offset + diagonal] = x;

      if (x >= n && y >= m) {
        trace.push(reach.slice(offset - edits, offset + edits + 1));

        return insertsFrom(trace, { m, n });
      }
    }

    trace.push(reach.slice(offset - edits, offset + edits + 1));
  }

  return unmatched(previous, next);
};

/** The lines of `next` that are not in `previous`, numbered from 1. */
const added = (
  previous: readonly string[],
  next: readonly string[]
): readonly AddedLine[] => {
  let start = 0;

  while (
    start < previous.length &&
    start < next.length &&
    previous[start] === next[start]
  ) {
    start += 1;
  }

  let end = 0;

  while (
    end < previous.length - start &&
    end < next.length - start &&
    previous[previous.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end += 1;
  }

  const middle = myers(
    previous.slice(start, previous.length - end),
    next.slice(start, next.length - end)
  );

  return middle.map((index) => ({
    line: start + index + 1,
    text: next[start + index] ?? "",
  }));
};

const blobOf = (repo: RepoName, blob: BlobSha) =>
  RepoHost.use((host) => host.readBlob(repo, ObjectId.make(blob))).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.die(`${repo} has no blob ${blob}`),
        onSome: Effect.succeed,
      })
    )
  );

const textOf = (repo: RepoName, blob: BlobSha | undefined) =>
  blob === undefined
    ? Effect.succeedSome<readonly string[]>([])
    : blobOf(repo, blob).pipe(
        Effect.map((bytes) =>
          isBinary(bytes) ? Option.none() : Option.some(linesOf(bytes))
        )
      );

/**
 * The lines each added or modified file gained, by a line diff of its blobs.
 * A binary blob (a NUL in its first 8 KiB) reports no lines.
 */
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
          READS
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
    READS
  ).pipe(Effect.map((entries) => new Map(entries)));
