/**
 * Code history kept by immutable ids. Keys:
 * `<repo>/<kind>/v<version>/<commit>/<scan>/<sha256(path)>`; `commit` is never
 * `main` or a tag (those resolve first), the path is hashed to keep a key
 * under the store's 1,024 bytes, and only a canonical repo is ever keyed.
 * Values hold ids and ranges, never a file's text or a landing.
 */
import { WhyRange } from "@repo/protocol/domain/code";
import { BlobSha, CommitSha } from "@repo/protocol/ids";
import type { RepoName, RepoPath } from "@repo/protocol/ids";
import { Effect, Option, Schema } from "effect";

import { CodeStore } from "../code-store.ts";
import { CodeCache } from "./cache.ts";

export const WHY_VERSION = 1;

export const LOG_VERSION = 1;

export const INCREMENT_REACH = 16;

export const StoredWhy = Schema.Struct({
  blob: BlobSha,
  ranges: Schema.Array(WhyRange),
  shas: Schema.Array(CommitSha),
  stoppedAt: Schema.optionalKey(CommitSha),
});

export type StoredWhy = typeof StoredWhy.Type;

export const StoredPathLog = Schema.Struct({
  reachedRoot: Schema.Boolean,
  shas: Schema.Array(CommitSha),
});

export type StoredPathLog = typeof StoredPathLog.Type;

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

/** A miss is never cached, so a value another isolate keeps later is found. */
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

/** A fork's reads keep nothing: the store is keyed under a canonical repo alone. */
export const keptOnlyIfCanonical = <A, E, R>(
  at: { readonly canonical: boolean },
  read: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  at.canonical
    ? read
    : Effect.provideService(read, CodeStore, CodeStore.defaultValue());

/** A failure is never kept. */
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
