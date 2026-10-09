/**
 * Code history kept by immutable ids: what a why or a
 * path's log computed from a commit, which that commit's content fixes for
 * good, so any isolate reads it back instead of walking history again.
 *
 * Keys: `<repo>/<kind>/v<version>/<commit>/<scan>/<sha256(path)>`, where
 * `kind` is `why` (version `WHY_VERSION`) or `path-log` (version
 * `LOG_VERSION`), `commit` is a commit id (never `main` or a tag's name:
 * those resolve first), `scan` is how many first-parent commits the walk
 * took, and the path is hashed so a key stays under the store's 1,024
 * bytes. Only a project's canonical repo is ever keyed (principle 7). A
 * version moves when its algorithm changes, so an old value is never read
 * as a new one.
 *
 * Values: ids and ranges, encoded with Schema; never a file's text, and
 * never a landing (each view asks the project's record for those, so a
 * later landing shows at once). A value that fails to decode is a miss.
 *
 * Read order: the isolate's `CodeCache` (with the heavy reads: a why's
 * ranges grow with its file), then the `CodeStore`, then the walk; what a
 * walk computed is put in both. A walk may start from what is
 * kept at a first-parent ancestor at most `INCREMENT_REACH` commits back,
 * so a new landing on main costs a handful of reads.
 */
import { WhyRange } from "@repo/protocol/domain/code";
import { BlobSha, CommitSha } from "@repo/protocol/ids";
import type { RepoName, RepoPath } from "@repo/protocol/ids";
import { Effect, Option, Schema } from "effect";

import { CodeStore } from "../code-store.ts";
import { CodeCache } from "./cache.ts";

/** The why walk's algorithm version, in its keys. */
export const WHY_VERSION = 1;

/** The path log's algorithm version, in its keys. */
export const LOG_VERSION = 1;

/** How many first-parent commits back a walk looks for a kept result to start from. */
export const INCREMENT_REACH = 16;

/**
 * Why each line is there at a commit: the path's blob there, the ranges,
 * the commits they name (newest first), and where the walk stopped.
 */
export const StoredWhy = Schema.Struct({
  blob: BlobSha,
  ranges: Schema.Array(WhyRange),
  shas: Schema.Array(CommitSha),
  stoppedAt: Schema.optionalKey(CommitSha),
});

export type StoredWhy = typeof StoredWhy.Type;

/**
 * A path's history from a commit: the first-parent commits of the scan
 * that changed it, newest first, and whether the scan reached the root.
 */
export const StoredPathLog = Schema.Struct({
  reachedRoot: Schema.Boolean,
  shas: Schema.Array(CommitSha),
});

export type StoredPathLog = typeof StoredPathLog.Type;

/** The lowercase hex SHA-256 of `text`. */
const sha256 = (text: string) =>
  Effect.map(
    Effect.promise(() =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    ),
    (digest) =>
      [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
  );

/** One kind of kept history: its key's kind and version, and its value. */
export interface Kept<A> {
  readonly kind: string;
  readonly version: number;
  readonly schema: Schema.Codec<A, unknown>;
}

export const whyKept: Kept<StoredWhy> = {
  kind: "why",
  schema: StoredWhy,
  version: WHY_VERSION,
};

export const pathLogKept: Kept<StoredPathLog> = {
  kind: "path-log",
  schema: StoredPathLog,
  version: LOG_VERSION,
};

/** Where `kept` is kept for `path` from `commit`, scanning `scan` commits. */
export const keyOf = <A>(
  kept: Kept<A>,
  at: {
    readonly repo: RepoName;
    readonly commit: CommitSha;
    readonly scan: number;
    readonly path: RepoPath;
  }
) =>
  Effect.map(
    sha256(at.path),
    (hash) =>
      `${at.repo}/${kept.kind}/v${kept.version}/${at.commit}/${at.scan}/${hash}`
  );

/**
 * What is kept under `key`: the isolate's cache first, then the store. A
 * miss is never cached, so a value another isolate keeps later is found.
 */
export const recall = <A>(
  kept: Kept<A>,
  key: string
): Effect.Effect<Option.Option<A>> =>
  Effect.gen(function* () {
    const cache = yield* CodeCache;
    const store = yield* CodeStore;

    const decode = Schema.decodeUnknownOption(
      Schema.fromJsonString(kept.schema)
    );

    return yield* cache.through(
      key,
      Effect.map(store.get(key), Option.flatMap(decode)),
      { heavy: true, keep: Option.isSome }
    );
  });

/** `value` kept under `key`, in the isolate's cache and in the store. */
export const remember = <A>(
  kept: Kept<A>,
  key: string,
  value: A
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const cache = yield* CodeCache;
    const store = yield* CodeStore;

    const encoded = yield* Schema.encodeEffect(
      Schema.fromJsonString(kept.schema)
    )(value).pipe(Effect.orDie);

    yield* store.put(key, encoded);
    yield* cache.through(key, Effect.succeedSome(value), { heavy: true });
  });

/**
 * What is kept under `key`, else `compute` run and its value kept: a
 * failure is never kept.
 */
export const throughHistory = <A, E, R>(
  kept: Kept<A>,
  key: string,
  compute: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.flatMap(recall(kept, key), (found) =>
    Option.match(found, {
      onNone: () => Effect.tap(compute, (value) => remember(kept, key, value)),
      onSome: Effect.succeed,
    })
  );
