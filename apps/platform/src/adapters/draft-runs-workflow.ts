import { DraftRuns } from "@repo/project/draft-runs";
import { Effect, Layer, Schema } from "effect";

import { DraftParams, draftId } from "../answer-runs.ts";

export interface DraftInstance {
  readonly id: string;
  readonly restart: () => Promise<void>;
  readonly status: () => Promise<{ readonly status: InstanceStatus["status"] }>;
}

export interface DraftWorkflow {
  readonly create: (options: {
    readonly id: string;
    readonly params: typeof DraftParams.Encoded;
  }) => Promise<{ readonly id: string }>;
  readonly get: (id: string) => Promise<DraftInstance>;
}

const encodeParams = Schema.encodeEffect(DraftParams);

// A complete round is left alone: running it again would ask the model again.
const failed: ReadonlySet<InstanceStatus["status"]> = new Set([
  "errored",
  "terminated",
]);

const runAgain = (instance: DraftInstance) =>
  Effect.gen(function* () {
    const { status } = yield* Effect.tryPromise(() => instance.status());

    if (failed.has(status)) {
      yield* Effect.tryPromise(() => instance.restart());
    }
  });

export const DraftRunsWorkflow = (
  workflow: DraftWorkflow
): Layer.Layer<never> =>
  Layer.succeed(DraftRuns, {
    start: (round) =>
      Effect.gen(function* () {
        const params = yield* encodeParams(DraftParams.make(round));
        const id = draftId(round);

        yield* Effect.tryPromise(() => workflow.create({ id, params })).pipe(
          // The id is taken: the round was started before.
          Effect.catch((error) =>
            Effect.tryPromise(() => workflow.get(id)).pipe(
              Effect.mapError(() => error),
              Effect.flatMap(runAgain)
            )
          )
        );
      }).pipe(Effect.orDie),
  });
