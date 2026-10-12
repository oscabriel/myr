import { Effect, Layer, Option } from "effect";

import { ReleaseStore } from "../releases.ts";

export interface ReleaseBucket {
  readonly get: (key: string) => Promise<{
    readonly body: ReadableStream;
    readonly size: number;
  } | null>;
}

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
