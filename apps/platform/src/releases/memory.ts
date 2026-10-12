import { Context, Effect, Layer, Option, Predicate, Ref } from "effect";

import { ReleaseStore } from "../releases.ts";

export class ReleaseReads extends Context.Service<
  ReleaseReads,
  { readonly keys: Effect.Effect<readonly string[]> }
>()("platform/ReleaseReads") {}

const encoder = new TextEncoder();

export const ReleaseStoreMemory = {
  layer: (
    files: Readonly<Record<string, string | Uint8Array>>
  ): Layer.Layer<ReleaseStore | ReleaseReads> =>
    Layer.effectContext(
      Effect.gen(function* () {
        const reads = yield* Ref.make<readonly string[]>([]);

        const kept = new Map(
          Object.entries(files).map(([key, file]) => [
            key,
            Predicate.isString(file) ? encoder.encode(file) : file,
          ])
        );

        return Context.make(ReleaseStore, {
          get: (key) =>
            Effect.as(
              Ref.update(reads, (keys) => [...keys, key]),
              Option.map(Option.fromUndefinedOr(kept.get(key)), (body) => ({
                body,
                size: body.byteLength,
              }))
            ),
        }).pipe(Context.add(ReleaseReads, { keys: Ref.get(reads) }));
      })
    ),
};
