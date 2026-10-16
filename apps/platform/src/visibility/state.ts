// A salt is kept only in the project's Durable Object: no ledger entry, trailer,
// note or event carries it.
import type { Fetch } from "@repo/artifacts/fetch";
import {
  AdmissionStarts,
  ProjectVisibilityLive,
  SaltSource,
} from "@repo/project/visibility/state";
import { Effect, Layer, Schema } from "effect";

import { disposed } from "../adapters/rpc-result.ts";
import { AdmissionParams, admissionId } from "../answer-runs.ts";
import type { PlatformConfig } from "../platform.ts";
import { layerRepos } from "./layer-repos.ts";

export const WebCryptoSalts: Layer.Layer<SaltSource> = Layer.succeed(
  SaltSource,
  SaltSource.of({
    next: Effect.sync(() => crypto.getRandomValues(new Uint8Array(32))),
  })
);

export interface AdmissionWorkflow {
  readonly create: (options: {
    readonly id: string;
    readonly params: typeof AdmissionParams.Encoded;
  }) => Promise<{ readonly id: string }>;
  readonly get: (id: string) => Promise<{ readonly id: string }>;
}

const encodeParams = Schema.encodeEffect(AdmissionParams);

export const admissionStarts = (
  workflow: AdmissionWorkflow
): Layer.Layer<AdmissionStarts> =>
  Layer.succeed(
    AdmissionStarts,
    AdmissionStarts.of({
      start: (input) =>
        Effect.gen(function* () {
          const params = AdmissionParams.make(input);
          const id = admissionId(params);
          const encoded = yield* encodeParams(params);

          yield* Effect.tryPromise(() =>
            workflow.create({ id, params: encoded })
          ).pipe(
            // The id is taken: the admission was started before.
            Effect.catch((error) =>
              Effect.tryPromise(() => workflow.get(id)).pipe(
                Effect.mapError(() => error)
              )
            ),
            Effect.flatMap(disposed)
          );
        }).pipe(Effect.orDie),
    })
  );

export const stateLive = (
  config: PlatformConfig
): Layer.Layer<never, never, Fetch> =>
  ProjectVisibilityLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerRepos(config),
        WebCryptoSalts,
        admissionStarts(config.ANSWER)
      )
    )
  );
