/**
 * Objects kept by their id across isolates: a commit, a tree's entries, a
 * blob's contents, a log page from a commit and the blob a path names at a
 * commit. What an id names never changes, so a kept object is read from the
 * store before the host, with the isolate's cache in front. Keys follow
 * history's: `<repo>/<kind>/v<version>/<id>`, and only a canonical repo is
 * ever keyed (`keptOnlyIfCanonical`). A store that cannot answer is a miss,
 * and a kept value that no longer decodes is read again and replaced.
 */
import { Commit, TreeEntry } from "@repo/artifacts/repo-host";
import { BlobSha } from "@repo/protocol/ids";
import type { CommitSha, RepoName, RepoPath } from "@repo/protocol/ids";
import { Data, Effect, Option, Schema } from "effect";

import { CodeStore } from "../code-store.ts";
import { CodeCache } from "./cache.ts";
import type { Keeping } from "./cache.ts";
import { hashOf } from "./history.ts";

/** Bump when what is kept changes. */
export const OBJECT_VERSION = 1;

export const StoredBlob = Schema.Struct({
  binary: Schema.Boolean,
  size: Schema.Int,
  text: Schema.OptionFromOptionalKey(Schema.String),
  truncated: Schema.Boolean,
});

export type StoredBlob = typeof StoredBlob.Type;

/** The blob a path names at a commit: an id alone, whose contents are kept by it. */
export const StoredFile = Schema.Struct({ blob: BlobSha });

export type StoredFile = typeof StoredFile.Type;

/** A kind of kept object, its codec built once: a read decodes and keeps thousands of them. */
export interface KeptObject<A> {
  readonly kind: string;
  readonly version: number;
  readonly decode: (text: string) => Option.Option<A>;
  readonly encode: (value: A) => Effect.Effect<string, Schema.SchemaError>;
}

const keptObject = <A>(
  kind: string,
  schema: Schema.Codec<A, unknown>
): KeptObject<A> => {
  const json = Schema.fromJsonString(schema);

  return {
    decode: Schema.decodeUnknownOption(json),
    encode: Schema.encodeEffect(json),
    kind,
    version: OBJECT_VERSION,
  };
};

export const commitKept = keptObject("commit-object", Commit);

export const treeKept = keptObject("tree", Schema.Array(TreeEntry));

export const blobKept = keptObject("blob", StoredBlob);

export const logKept = keptObject("log", Schema.Array(Commit));

export const fileKept = keptObject("file", StoredFile);

export const objectKey = <A>(kept: KeptObject<A>, repo: RepoName, id: string) =>
  `${repo}/${kept.kind}/v${kept.version}/${id}`;

/** A log page from a commit is immutable too: first parents never move. */
export const logKey = (
  repo: RepoName,
  sha: CommitSha,
  from: number,
  count: number
) => objectKey(logKept, repo, `${sha}/${from}/${count}`);

/** The path is hashed, as history hashes it, to keep the key under the store's limit. */
export const fileKey = (repo: RepoName, commit: CommitSha, path: RepoPath) =>
  Effect.map(hashOf(path), (hash) =>
    objectKey(fileKept, repo, `${commit}/${hash}`)
  );

export interface KeepingObject<A> {
  readonly heavy?: boolean;
  /** Whether a value is worth keeping, in the isolate and the store alike. */
  readonly keep?: (value: A) => boolean;
  /** Whether a kept value is the one its key names; one that is not is read again. */
  readonly fits?: (value: A) => boolean;
}

class ObjectMissing extends Data.TaggedError("ObjectMissing") {}

const always = () => true;

interface Told<A> {
  heavy?: boolean;
  keep?: (value: A) => boolean;
}

/** What the isolate's cache is told: only the fields given, since an absent one means the default. */
const cacheKeeping = <A>(keeping: KeepingObject<A>): Keeping<A> => {
  const told: Told<A> = {};

  if (keeping.heavy !== undefined) {
    told.heavy = keeping.heavy;
  }

  if (keeping.keep !== undefined) {
    told.keep = keeping.keep;
  }

  return told;
};

const putKept = <A>(kept: KeptObject<A>, key: string, value: A) =>
  Effect.gen(function* () {
    const store = yield* CodeStore;

    yield* kept.encode(value).pipe(
      Effect.flatMap((text) => store.put(key, text)),
      Effect.catch((error) => Effect.logWarning(`${key} was not kept`, error))
    );
  });

/**
 * An object read by another call, kept under its own key: in the store, and
 * in the isolate's cache past any view's dedupe, so a view that missed the
 * key first still finds it.
 */
export const keepObject = <A>(
  kept: KeptObject<A>,
  key: string,
  value: A,
  keeping: KeepingObject<A> = {}
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const cache = yield* CodeCache;
    const keep = keeping.keep ?? always;

    if (!keep(value)) {
      return;
    }

    yield* putKept(kept, key, value);
    yield* cache.through(key, Effect.succeed(value), {
      ...cacheKeeping(keeping),
      keep,
    });
  });

/**
 * An object by its key: the isolate's cache, then the store, then `compute`.
 * A miss (`None`) is kept nowhere, since the object may yet be pushed.
 */
export const throughStore = <A, E, R>(
  kept: KeptObject<A>,
  key: string,
  compute: Effect.Effect<Option.Option<A>, E, R>,
  keeping: KeepingObject<A> = {}
): Effect.Effect<Option.Option<A>, E, R> =>
  Effect.gen(function* () {
    const cache = yield* CodeCache;
    const store = yield* CodeStore;
    const keep = keeping.keep ?? always;
    const fits = keeping.fits ?? always;

    const read: Effect.Effect<A, E | ObjectMissing, R> = Effect.gen(
      function* () {
        const found = Option.filter(
          Option.flatMap(yield* store.get(key), kept.decode),
          fits
        );

        if (Option.isSome(found)) {
          return found.value;
        }

        const computed = yield* compute;

        if (Option.isNone(computed)) {
          return yield* new ObjectMissing();
        }

        if (keep(computed.value)) {
          yield* putKept(kept, key, computed.value);
        }

        return computed.value;
      }
    );

    return yield* cache.through(key, read, cacheKeeping(keeping)).pipe(
      Effect.asSome,
      Effect.catchTag("ObjectMissing", () => Effect.succeedNone)
    );
  });
