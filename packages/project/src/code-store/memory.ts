/**
 * The code store in memory, for tests: a map per layer, and a count of
 * every get and put, so a test can say a read was served from the store.
 */
import { Context, Effect, Layer, Option, Ref } from "effect";

import { CodeStore, fittingKey } from "../code-store.ts";
import type { CodeStoreApi } from "../code-store.ts";

/** How often the memory store was asked, for tests. */
export class CodeStoreCounts extends Context.Service<
  CodeStoreCounts,
  {
    readonly counts: Effect.Effect<{
      readonly gets: number;
      readonly puts: number;
    }>;
  }
>()("project/CodeStoreCounts") {}

/** A fresh store in memory, with its counts. */
export const CodeStoreMemory = Layer.effectContext(
  Effect.gen(function* () {
    const kept = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
    const counts = yield* Ref.make({ gets: 0, puts: 0 });

    const store: CodeStoreApi = {
      get: (key) =>
        Effect.gen(function* () {
          const fit = yield* fittingKey(key);

          yield* Ref.update(counts, ({ gets, puts }) => ({
            gets: gets + 1,
            puts,
          }));

          return Option.fromUndefinedOr((yield* Ref.get(kept)).get(fit));
        }),
      put: (key, value) =>
        Effect.gen(function* () {
          const fit = yield* fittingKey(key);

          yield* Ref.update(counts, ({ gets, puts }) => ({
            gets,
            puts: puts + 1,
          }));
          yield* Ref.update(kept, (all) => new Map([...all, [fit, value]]));
        }),
    };

    return Context.make(CodeStore, store).pipe(
      Context.add(CodeStoreCounts, { counts: Ref.get(counts) })
    );
  })
);
