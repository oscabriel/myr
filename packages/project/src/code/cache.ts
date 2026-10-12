import { inRepoSession } from "@repo/artifacts/repo-host";
import { Cache, Context, Deferred, Effect, Exit, Layer, Option } from "effect";
import type { Cause, Scope } from "effect";

export interface Keeping<A> {
  readonly heavy?: boolean;
  readonly keep?: (value: A) => boolean;
}

export interface CodeReads {
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

const cacheOf = (capacity: number) =>
  Cache.make<string, unknown>({
    capacity,
    lookup: (key) => Effect.die(`the code cache never looks up ${key}`),
  });

// A read under way is never shared: a Worker whose client goes away is cancelled
// without interruption, so a joined read may never end and its joiner would hang.
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

const joined = <B, F>(
  under: Deferred.Deferred<Exit.Exit<unknown, unknown>>
): Effect.Effect<B, F> =>
  Effect.flatMap(Deferred.await(under), (exit) => {
    if (Exit.isSuccess(exit)) {
      // SAFETY: every key names one kind of read (`<repo>:<kind>:<id>`), so
      // the read under it was typed as the one that joins it.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one view shares every kind of read, so its map holds `unknown`; see SAFETY.
      return Effect.succeed(exit.value as B);
    }

    // SAFETY: as above, for the read's failure.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one view shares every kind of read, so its map holds `unknown`; see SAFETY.
    return Effect.failCause(exit.cause as Cause.Cause<F>);
  });

export const asOneView = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> =>
  inRepoSession(
    Effect.gen(function* () {
      const outer = yield* CodeCache;
      const scope = yield* Effect.scope;

      const reading = new Map<
        string,
        Deferred.Deferred<Exit.Exit<unknown, unknown>>
      >();

      const shared: CodeReads = {
        through: <B, F, S>(
          key: string,
          read: Effect.Effect<B, F, S>,
          keeping: Keeping<B> = {}
        ) =>
          keeping.heavy === true || keeping.keep !== undefined
            ? outer.through(key, read, keeping)
            : Effect.suspend(() => {
                const found = reading.get(key);

                if (found !== undefined) {
                  return joined<B, F>(found);
                }

                const done = Deferred.makeUnsafe<Exit.Exit<unknown, unknown>>();

                reading.set(key, done);

                return Effect.forkIn(
                  Effect.exit(outer.through(key, read, keeping)).pipe(
                    Effect.flatMap((exit) => Deferred.succeed(done, exit))
                  ),
                  scope
                ).pipe(Effect.andThen(joined<B, F>(done)));
              }),
      };

      return yield* Effect.provideService(effect, CodeCache, shared);
    })
  );
