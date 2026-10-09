/**
 * The code reads' cache: what an object id names never changes, so a read
 * keyed by `<repo>:<kind>:<object id>` (a tree, a blob, a commit, a commit's
 * diff, a blame at a commit) is read once. A `Context.Reference` whose
 * default caches nothing, so every host composes before one is given; the
 * platform gives one held in a layer (no module-level state, principle 6),
 * so it lives as long as the isolate. `main` and a tag are never a key:
 * each resolves through the project's record or the repo's tags on every
 * call.
 *
 * Entries come in two weights, each in a cache of its own, so a count of
 * entries bounds the memory they take: trees and commits are light (a few
 * KiB), while a file's text, a commit's path list or changes and a page of
 * the log are heavy (up to hundreds of KiB), and an isolate holds 128 MB.
 */
import { Cache, Context, Effect, Layer, Option } from "effect";

/** How a read's value is kept. */
export interface Keeping<A> {
  /** Whether the value may weigh up to hundreds of KiB (a text, a list). */
  readonly heavy?: boolean;
  /** Whether this value may be kept at all; a larger one is read again. */
  readonly keep?: (value: A) => boolean;
}

/** The code reads, each kept by its key once read. */
export interface CodeReads {
  /**
   * `read`, or what it gave before for `key`. A failure is never kept,
   * and neither is a value `keeping.keep` turns down (a large file's text).
   */
  readonly through: <A, E, R>(
    key: string,
    read: Effect.Effect<A, E, R>,
    keeping?: Keeping<A>
  ) => Effect.Effect<A, E, R>;
}

export const CodeCache = Context.Reference<CodeReads>("project/CodeCache", {
  defaultValue: () => ({ through: (_key, read) => read }),
});

const always = () => true;

/**
 * One cache of at most `capacity` values, each kept for good once set. It
 * never runs a lookup: a value enters only through `Cache.set`, once its
 * read has finished, so no entry is ever a read still under way.
 */
const cacheOf = (capacity: number) =>
  Cache.make<string, unknown>({
    capacity,
    lookup: (key) => Effect.die(`the code cache never looks up ${key}`),
  });

/**
 * `read` through `cache`: what it kept for `key`, else `read` run by this
 * caller, its value kept when `keep` allows. A read under way is never
 * shared: a Worker whose client goes away is cancelled where it stands,
 * with no interruption, so a read another request began may never end, and
 * a caller that joined it would hang with it.
 */
const throughCache =
  (cache: Cache.Cache<string, unknown>) =>
  <A, E, R>(
    key: string,
    read: Effect.Effect<A, E, R>,
    keep: (value: A) => boolean
  ) =>
    Effect.gen(function* () {
      const kept = yield* Cache.getSuccess(cache, key);

      if (Option.isSome(kept)) {
        // SAFETY: every key names one kind of read (`<repo>:<kind>:<id>`), so the
        // value kept under it is what a read typed as this one gave.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one cache holds every kind of read, so its values are typed `unknown`; see SAFETY.
        return kept.value as A;
      }

      const value = yield* read;

      if (keep(value)) {
        yield* Cache.set(cache, key, value);
      }

      return value;
    });

/**
 * At most `capacity` light reads and `heavy` heavy ones, the least
 * recently used of each dropped first. Only a finished read is kept: two
 * calls with one key while neither has finished each read for themselves,
 * and a failure is never kept.
 */
export const CodeCacheLive = (
  capacity: number,
  heavy = Math.max(1, Math.ceil(capacity / 50))
) =>
  Layer.effect(
    CodeCache,
    Effect.gen(function* () {
      const light = throughCache(yield* cacheOf(capacity));
      const weighty = throughCache(yield* cacheOf(heavy));

      const reads: CodeReads = {
        through: <A, E, R>(
          key: string,
          read: Effect.Effect<A, E, R>,
          keeping: Keeping<A> = {}
        ) =>
          (keeping.heavy === true ? weighty : light)(
            key,
            read,
            keeping.keep ?? always
          ),
      };

      return reads;
    })
  );
