/**
 * W2 214's `AnswerRuns` port over the `Answer` Workflow (W3 304): starting
 * an answer's run makes the Workflow instance whose id is the request id,
 * with the project and the request as its params. The instance runs the
 * answer's steps through the project's DO (`Projects`), so the port's
 * in-process `queue` is not used here.
 *
 * Starting twice is starting once (principle 8): an instance with the id
 * already exists, so `create` refuses, and the adapter takes the instance it
 * finds instead. Any other failure is a defect: the outbox row that asked
 * for the start stays, and the project's next alarm runs it again.
 */
import { AnswerRuns } from "@repo/project/answer-runs";
import type { ProjectName } from "@repo/protocol/ids";
import { Effect, Layer, Schema } from "effect";

import { AnswerParams } from "../answer-runs.ts";

/** The part of the `Answer` Workflow binding the adapter uses. */
export interface AnswerWorkflow {
  readonly create: (options: {
    readonly id: string;
    readonly params: typeof AnswerParams.Encoded;
  }) => Promise<{ readonly id: string }>;
  readonly get: (id: string) => Promise<{ readonly id: string }>;
}

const encodeParams = Schema.encodeEffect(AnswerParams);

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
            // The id is taken: the run was started before.
            Effect.catch((error) =>
              Effect.tryPromise(() => workflow.get(requestId)).pipe(
                Effect.mapError(() => error)
              )
            )
          );
        }).pipe(Effect.orDie),
    })
  );
