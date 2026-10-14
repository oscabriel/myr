import { Data, Effect, Layer, Option } from "effect";

import { CodeStore, fittingKey } from "../code-store.ts";
import type { CodeStoreApi } from "../code-store.ts";

/** Structural, so the package needs no Workers types. */
export interface BucketLike {
  readonly get: (
    key: string
  ) => Promise<{ readonly text: () => Promise<string> } | null>;
  readonly put: (
    key: string,
    value: string
  ) => Promise<{ readonly key: string } | null>;
}

/** The colo's cache (`caches.default`), structural as the bucket is. */
export interface EdgeCacheLike {
  readonly match: (url: string) => Promise<Response | undefined>;
  readonly put: (url: string, response: Response) => Promise<void>;
}

class CodeStoreUnreachable extends Data.TaggedError("CodeStoreUnreachable")<{
  readonly cause: unknown;
}> {}

const reach = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (cause) => new CodeStoreUnreachable({ cause }),
    try: run,
  });

// `.invalid` never resolves, so no visitor's request can reach an entry: only this
// Worker's own `match` reads one. Every key is an object id, or a commit with an
// algorithm version, so an entry never goes stale and is kept for a month.
const edgeUrl = (key: string) =>
  `https://code-store.invalid/${encodeURIComponent(key)}`;

const EDGE_KEPT = "public, max-age=2592000";

// The colo's cache only spares R2 a trip, so its failures are misses, logged below a warning.
const edgeReads = (edge: () => EdgeCacheLike) => ({
  get: (key: string) =>
    reach(() => edge().match(edgeUrl(key))).pipe(
      Effect.flatMap((found) =>
        found === undefined
          ? Effect.succeedNone
          : Effect.asSome(reach(() => found.text()))
      ),
      Effect.catchTag("CodeStoreUnreachable", ({ cause }) =>
        Effect.as(
          Effect.logDebug(`the colo's cache could not read ${key}`, cause),
          Option.none<string>()
        )
      )
    ),
  put: (key: string, value: string) =>
    reach(() =>
      edge().put(
        edgeUrl(key),
        new Response(value, { headers: { "cache-control": EDGE_KEPT } })
      )
    ).pipe(
      Effect.catchTag("CodeStoreUnreachable", ({ cause }) =>
        Effect.logDebug(`the colo's cache could not keep ${key}`, cause)
      )
    ),
});

/**
 * R2, with the colo's cache in front when one is given: a few milliseconds on
 * a hit where R2 takes a hundred, which a cold isolate's chain of reads feels.
 */
export const CodeStoreR2 = (bucket: BucketLike, edge?: () => EdgeCacheLike) => {
  const front = edge === undefined ? undefined : edgeReads(edge);

  const fromBucket = (fit: string) =>
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
    );

  const toBucket = (fit: string, value: string): Effect.Effect<void> =>
    reach(() => bucket.put(fit, value)).pipe(
      Effect.asVoid,
      Effect.catchTag("CodeStoreUnreachable", ({ cause }) =>
        Effect.logWarning(`the code store could not keep ${fit}`, cause)
      )
    );

  const store: CodeStoreApi = {
    get: (key) =>
      Effect.flatMap(fittingKey(key), (fit) =>
        front === undefined
          ? fromBucket(fit)
          : Effect.flatMap(
              front.get(fit),
              Option.match({
                onNone: () =>
                  Effect.tap(
                    fromBucket(fit),
                    Option.match({
                      onNone: () => Effect.void,
                      onSome: (found) => front.put(fit, found),
                    })
                  ),
                onSome: (kept) => Effect.succeedSome(kept),
              })
            )
      ),
    put: (key, value) =>
      Effect.flatMap(fittingKey(key), (fit) =>
        front === undefined
          ? toBucket(fit, value)
          : Effect.all([toBucket(fit, value), front.put(fit, value)], {
              concurrency: "unbounded",
              discard: true,
            })
      ),
  };

  return Layer.succeed(CodeStore, store);
};
