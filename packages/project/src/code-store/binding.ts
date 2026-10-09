/**
 * The code store over an R2 bucket (the platform's `CODE_CACHE`). R2 is
 * strongly consistent, so a value one isolate puts, every other reads next.
 * A get or a put that fails is logged and read as a miss: a store outage
 * slows a read, and never fails it.
 */
import { Data, Effect, Layer, Option } from "effect";

import { CodeStore, fittingKey } from "../code-store.ts";
import type { CodeStoreApi } from "../code-store.ts";

/**
 * The slice of `R2Bucket` the store calls. Structural, so the package needs
 * no Workers types; `apps/platform/test/bindings.test.ts` holds the
 * generated `Env["CODE_CACHE"]` to it.
 */
export interface BucketLike {
  readonly get: (
    key: string
  ) => Promise<{ readonly text: () => Promise<string> } | null>;
  readonly put: (
    key: string,
    value: string
  ) => Promise<{ readonly key: string } | null>;
}

/** R2 refused or never answered one call on one key. */
class CodeStoreUnreachable extends Data.TaggedError("CodeStoreUnreachable")<{
  readonly cause: unknown;
}> {}

/** One call on the bucket. */
const reach = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (cause) => new CodeStoreUnreachable({ cause }),
    try: run,
  });

/** The store over `bucket`. */
export const CodeStoreR2 = (bucket: BucketLike) => {
  const store: CodeStoreApi = {
    get: (key) =>
      Effect.flatMap(fittingKey(key), (fit) =>
        reach(() => bucket.get(fit)).pipe(
          Effect.flatMap((found) =>
            found === null
              ? Effect.succeedNone
              : Effect.asSome(reach(() => found.text()))
          ),
          Effect.catchTag("CodeStoreUnreachable", ({ cause }) =>
            Effect.as(
              Effect.logWarning(`the code store could not read ${fit}`, cause),
              Option.none<string>()
            )
          )
        )
      ),
    put: (key, value) =>
      Effect.flatMap(fittingKey(key), (fit) =>
        reach(() => bucket.put(fit, value)).pipe(
          Effect.asVoid,
          Effect.catchTag("CodeStoreUnreachable", ({ cause }) =>
            Effect.logWarning(`the code store could not keep ${fit}`, cause)
          )
        )
      ),
  };

  return Layer.succeed(CodeStore, store);
};
