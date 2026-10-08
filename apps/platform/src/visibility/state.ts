/**
 * The visibility cartridge's project state, as the platform provides it
 * (W6 612): the project service's live `ProjectVisibility` over the private
 * namespace's repos (`LayerRepos` over `ARTIFACTS_PRIVATE`), secret salts
 * from WebCrypto's randomness at the platform's edge, and admissions
 * started as runs of the `Answer` Workflow under their own params.
 *
 * A salt is drawn here and kept only in the project's Durable Object (the
 * layer's row): no ledger entry, trailer, note or event carries it, and
 * nothing reveals it yet (`reveal` stays "on retire or dispute", as config).
 */
import type { Fetch } from "@repo/artifacts/fetch";
import {
  AdmissionStarts,
  ProjectVisibilityLive,
  SaltSource,
} from "@repo/project/visibility/state";
import { Effect, Layer, Schema } from "effect";

import { AdmissionParams, admissionId } from "../answer-runs.ts";
import type { PlatformConfig } from "../platform.ts";
import { layerRepos } from "./layer-repos.ts";

/** 32 bytes from WebCrypto's randomness: each layer commit's commitment gets its own. */
export const WebCryptoSalts: Layer.Layer<SaltSource> = Layer.succeed(
  SaltSource,
  SaltSource.of({
    next: Effect.sync(() => crypto.getRandomValues(new Uint8Array(32))),
  })
);

/** The part of the `Answer` Workflow binding an admission's start uses. */
export interface AdmissionWorkflow {
  readonly create: (options: {
    readonly id: string;
    readonly params: typeof AdmissionParams.Encoded;
  }) => Promise<{ readonly id: string }>;
  readonly get: (id: string) => Promise<{ readonly id: string }>;
}

const encodeParams = Schema.encodeEffect(AdmissionParams);

/**
 * Admissions as runs of the `Answer` Workflow (609 #8), one instance per
 * project, layer and head (`admissionId`): starting one twice finds the
 * instance the first made, so it runs once. Any other failure is a defect,
 * and the outbox row that asked for the start runs it again.
 */
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
            )
          );
        }).pipe(Effect.orDie),
    })
  );

/** The live project state for one stage's config, over the platform's `Fetch`. */
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
