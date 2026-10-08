/**
 * The project service's `AnswerRuns` port over the `Answer` Workflow: starting
 * an answer's run makes the Workflow instance whose id is the request id,
 * with the project and the request as its params. The instance runs the
 * answer's steps through the project's DO (`Projects`), so the port's
 * in-process `queue` is not used here.
 *
 * Starting twice is starting once (principle 8): an instance with the id
 * already exists, so `create` refuses, and the adapter takes the instance it
 * finds instead. A run ends whenever the answer waits (the landing slot, a
 * finish, a decision, a retry), and the project starts the same request
 * again once it can go on, so an instance whose run has ended
 * (complete, errored or terminated) is restarted from its first step; each
 * step re-reads the run from the DO, so a fresh run picks up where the
 * answer stands. An instance still running is left alone. Any other failure
 * is a defect: the outbox row that asked for the start stays, and the
 * project's next alarm runs it again.
 */
import { AnswerRuns } from "@repo/project/answer-runs";
import type { ProjectName } from "@repo/protocol/ids";
import { Effect, Layer, Schema } from "effect";

import { AnswerParams } from "../answer-runs.ts";

/** The part of a Workflow instance the adapter uses. */
export interface AnswerInstance {
  readonly id: string;
  readonly restart: () => Promise<void>;
  readonly status: () => Promise<{ readonly status: InstanceStatus["status"] }>;
}

/** The part of the `Answer` Workflow binding the adapter uses. */
export interface AnswerWorkflow {
  readonly create: (options: {
    readonly id: string;
    readonly params: typeof AnswerParams.Encoded;
  }) => Promise<{ readonly id: string }>;
  readonly get: (id: string) => Promise<AnswerInstance>;
}

const encodeParams = Schema.encodeEffect(AnswerParams);

/** The states an instance's run has ended in, so a start must run it again. */
const ended: ReadonlySet<InstanceStatus["status"]> = new Set([
  "complete",
  "errored",
  "terminated",
]);

/** Restarts the instance when its run has ended; a running one is left alone. */
const runAgain = (instance: AnswerInstance) =>
  Effect.gen(function* () {
    const { status } = yield* Effect.tryPromise(() => instance.status());

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
            // The id is taken: the run was started before.
            Effect.catch((error) =>
              Effect.tryPromise(() => workflow.get(requestId)).pipe(
                Effect.mapError(() => error),
                Effect.flatMap(runAgain)
              )
            )
          );
        }).pipe(Effect.orDie),
    })
  );
