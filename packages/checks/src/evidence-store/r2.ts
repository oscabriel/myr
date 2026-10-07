/**
 * `EvidenceStore` over an R2 bucket: the stage's `evidence-<stage>` (spec
 * §4.4), so a lane's log outlives the isolate that ran its check. Each log
 * is one object, its key the log's own name (`logRefOf`), its body the text
 * whole, labelled with its project and lane and nothing else. Putting a log
 * again under the same name replaces it, so a replayed step converges
 * (principle 8).
 *
 * R2 is reached only through promises; each enters through
 * `Effect.tryPromise`, and a bucket that cannot be reached is a defect that
 * names the key, never the text: a log is for its readers alone.
 */
import { Data, Effect, Layer, Option } from "effect";

import { EvidenceStore, logRefOf } from "../evidence-store.ts";

/**
 * The part of an R2 bucket binding the store uses. Structural, so the Worker
 * passes its `EVIDENCE` binding itself; a type test holds `R2Bucket` to it
 * (`apps/platform/test/evidence.test.ts`).
 */
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

/** R2 refused or never answered a call on one key: the store cannot go on. */
class EvidenceUnreachable extends Data.TaggedError("EvidenceUnreachable")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

/** One call on the bucket for `key`; a failure dies naming the key and the call. */
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
