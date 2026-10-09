/**
 * The code reads' cache: what an object id names never changes, so a read
 * keyed by `<repo>:<kind>:<object id>` (a tree, a blob, a commit, a commit's
 * diff, a blame at a commit) is read once. A `Context.Reference` whose
 * default caches nothing, so every host composes before one is given; the
 * platform gives one held in a layer (no module-level state, principle 6),
 * so it lives as long as the isolate. `main` and a tag are never a key:
 * each resolves through the project's record or the repo's tags on every
 * call.
 */
import {
  Cache,
  Context,
  Duration,
  Effect,
  Equal,
  Exit,
  Hash,
  Layer,
  Option,
  Ref,
} from "effect";

/** The code reads, each kept by its key once read. */
export interface CodeReads {
  /**
   * `read`, or what it gave before for `key`. A failure is never kept,
   * and neither is a value `keep` turns down (a large file's text).
   */
  readonly through: <A, E, R>(
    key: string,
    read: Effect.Effect<A, E, R>,
    keep?: (value: A) => boolean
  ) => Effect.Effect<A, E, R>;
}

export const CodeCache = Context.Reference<CodeReads>("project/CodeCache", {
  defaultValue: () => ({ through: (_key, read) => read }),
});

/** What one read gave, when it succeeded, and whether it may be kept. */
interface Entry {
  readonly value: Option.Option<unknown>;
  readonly kept: boolean;
}

/**
 * One read and the key it is kept by: two are the same entry when their
 * keys are, whatever their reads (each a closure of its own).
 */
class Keyed implements Equal.Equal {
  readonly key: string;
  readonly read: Effect.Effect<Entry>;

  constructor(key: string, read: Effect.Effect<Entry>) {
    this.key = key;
    this.read = read;
  }

  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof Keyed && that.key === this.key;
  }

  [Hash.symbol](): number {
    return Hash.string(this.key);
  }
}

const always = () => true;

/** How long an entry is kept: for good when its read succeeded and may be kept, else not at all. */
const lifeOf = (exit: Exit.Exit<Entry>) =>
  Exit.isSuccess(exit) && exit.value.kept ? Duration.infinity : Duration.zero;

/**
 * A cache of at most `capacity` reads, the least recently used dropped
 * first. Two calls with one key while the first is under way share its
 * read; a caller whose own read ran gets its exit as it was, and one that
 * waited on a read that failed reads for itself.
 */
export const CodeCacheLive = (capacity: number) =>
  Layer.effect(
    CodeCache,
    Effect.map(
      Cache.makeWith((key: Keyed) => key.read, {
        capacity,
        timeToLive: lifeOf,
      }),
      (cache): CodeReads => ({
        through: <A, E, R>(
          key: string,
          read: Effect.Effect<A, E, R>,
          keep: (value: A) => boolean = always
        ) =>
          Effect.gen(function* () {
            const context = yield* Effect.context<R>();
            const own = yield* Ref.make(Option.none<Exit.Exit<A, E>>());

            const entry = yield* Cache.get(
              cache,
              new Keyed(
                key,
                Effect.exit(Effect.provideContext(read, context)).pipe(
                  Effect.tap((exit) => Ref.set(own, Option.some(exit))),
                  Effect.map((exit): Entry => ({
                    kept: Exit.isSuccess(exit) && keep(exit.value),
                    value: Exit.isSuccess(exit)
                      ? Option.some(exit.value)
                      : Option.none(),
                  }))
                )
              )
            );

            const ran = yield* Ref.get(own);

            if (Option.isSome(ran)) {
              return yield* ran.value;
            }

            if (Option.isNone(entry.value)) {
              return yield* read;
            }

            // SAFETY: every key names one kind of read (`<repo>:<kind>:<id>`), so the
            // value kept under it is what a read typed as this one gave.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one cache holds every kind of read, so its values are typed `unknown`; see SAFETY.
            return entry.value.value as A;
          }),
      })
    )
  );
