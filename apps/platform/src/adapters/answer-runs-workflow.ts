import { AnswerRuns } from "@repo/project/answer-runs";
import type { ProjectName } from "@repo/protocol/ids";
import { Effect, Layer, Schema } from "effect";

import { AnswerParams } from "../answer-runs.ts";
import { disposed } from "./rpc-result.ts";

export interface AnswerInstance {
  readonly id: string;
  readonly restart: () => Promise<void>;
  readonly status: () => Promise<{ readonly status: InstanceStatus["status"] }>;
}

export interface AnswerWorkflow {
  readonly create: (options: {
    readonly id: string;
    readonly params: typeof AnswerParams.Encoded;
  }) => Promise<{ readonly id: string }>;
  readonly get: (id: string) => Promise<AnswerInstance>;
}

const encodeParams = Schema.encodeEffect(AnswerParams);

// A run ends whenever the answer waits; the project starts the same request again once it can go on.
const ended: ReadonlySet<InstanceStatus["status"]> = new Set([
  "complete",
  "errored",
  "terminated",
]);

const runAgain = (instance: AnswerInstance) =>
  Effect.gen(function* () {
    const { status } = yield* Effect.tryPromise(() => instance.status()).pipe(
      Effect.flatMap(disposed)
    );

    if (ended.has(status)) {
      yield* Effect.tryPromise(() => instance.restart());
    }
  });

export const AnswerRunsWorkflow = (
  workflow: AnswerWorkflow,
  project: ProjectName
): Layer.Layer<AnswerRuns> =>
  Layer.succeed(
    AnswerRuns,
    AnswerRuns.of({
      start: (requestId) =>
        Effect.gen(function* () {
          const params = yield* encodeParams({ project, requestId });

          yield* Effect.tryPromise(() =>
            workflow.create({ id: requestId, params })
          ).pipe(
            Effect.flatMap(disposed),
            // The id is taken: the run was started before.
            Effect.catch((error) =>
              Effect.tryPromise(() => workflow.get(requestId)).pipe(
                Effect.mapError(() => error),
                Effect.flatMap((instance) =>
                  runAgain(instance).pipe(Effect.ensuring(disposed(instance)))
                )
              )
            )
          );
        }).pipe(Effect.orDie),
    })
  );
