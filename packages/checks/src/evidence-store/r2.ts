// A failure names the key, never the text: a log is for its readers alone.
import { Data, Effect, Layer, Option } from "effect";

import { EvidenceStore, logRefOf } from "../evidence-store.ts";

export interface EvidenceBucket {
  readonly put: (
    key: string,
    value: string,
    options: {
      readonly httpMetadata: { readonly contentType: string };
      readonly customMetadata: Record<string, string>;
    }
  ) => Promise<{ readonly key: string } | null>;
  readonly get: (
    key: string
  ) => Promise<{ readonly text: () => Promise<string> } | null>;
}

class EvidenceUnreachable extends Data.TaggedError("EvidenceUnreachable")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const reach = <A>(call: "get" | "put", key: string, run: () => Promise<A>) =>
  Effect.orDie(
    Effect.tryPromise({
      catch: (cause) =>
        new EvidenceUnreachable({
          cause,
          message: `the evidence bucket could not ${call} ${key}`,
        }),
      try: run,
    })
  );

export const EvidenceStoreR2 = (
  bucket: EvidenceBucket
): Layer.Layer<EvidenceStore> =>
  Layer.succeed(
    EvidenceStore,
    EvidenceStore.of({
      get: (ref) =>
        Effect.flatMap(
          reach("get", ref, () => bucket.get(ref)),
          (found) =>
            Option.match(Option.fromNullishOr(found), {
              onNone: () => Effect.succeedNone,
              onSome: (object) =>
                Effect.asSome(reach("get", ref, () => object.text())),
            })
        ),
      put: (log) => {
        const ref = logRefOf(log);

        return Effect.as(
          reach("put", ref, () =>
            bucket.put(ref, log.text, {
              customMetadata: { lane: log.lane, project: log.project },
              httpMetadata: { contentType: "text/plain; charset=utf-8" },
            })
          ),
          ref
        );
      },
    })
  );
