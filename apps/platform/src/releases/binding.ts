/**
 * `ReleaseStore` over the stage's `RELEASES` R2 bucket (`releases-<stage>`).
 * It only reads: the release script uploads with Wrangler.
 */
import { Effect, Layer, Option } from "effect";

import { ReleaseStore } from "../releases.ts";

/** The one call the store makes on the bucket, which `R2Bucket` answers. */
export interface ReleaseBucket {
  readonly get: (key: string) => Promise<{
    readonly body: ReadableStream;
    readonly size: number;
  } | null>;
}

/**
 * The store over `bucket`. A read the bucket fails is a defect, as every
 * binding's failure is here: the request answers 500 and nothing is
 * served.
 */
export const ReleaseStoreBinding = (
  bucket: ReleaseBucket
): Layer.Layer<ReleaseStore> =>
  Layer.succeed(
    ReleaseStore,
    ReleaseStore.of({
      get: (key) =>
        Effect.tryPromise(() => bucket.get(key)).pipe(
          Effect.orDie,
          Effect.map((found) =>
            Option.map(Option.fromNullishOr(found), ({ body, size }) => ({
              body,
              size,
            }))
          )
        ),
    })
  );
