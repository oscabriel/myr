/**
 * The project service's `DraftRuns` port over the `Answer` Workflow: a
 * draft's round runs as the instance `draftId` names (one per project,
 * proposal and round), with the round as params tagged `Draft`. The
 * instance asks the project's DO for what it needs, so the port carries
 * only the round.
 *
 * Starting twice is starting once (principle 8), as `answer-runs-workflow.ts`
 * does it: `create` refuses an id that exists, and the adapter takes the
 * instance it finds. Unlike an answer's, a round's run never waits to go on,
 * so a `complete` instance is left alone (a fresh run would ask the model
 * again for a round already settled); an `errored` or `terminated` one is
 * restarted from its first step. Any other failure is a defect: the outbox
 * row that asked for the start stays, and the project's next alarm runs it
 * again.
 */
import { DraftRuns } from "@repo/project/draft-runs";
import { Effect, Layer, Schema } from "effect";

import { DraftParams, draftId } from "../answer-runs.ts";

/** The part of a Workflow instance the adapter uses. */
export interface DraftInstance {
  readonly id: string;
  readonly restart: () => Promise<void>;
  readonly status: () => Promise<{ readonly status: InstanceStatus["status"] }>;
}

/** The part of the `Answer` Workflow binding the adapter uses. */
export interface DraftWorkflow {
  readonly create: (options: {
    readonly id: string;
    readonly params: typeof DraftParams.Encoded;
  }) => Promise<{ readonly id: string }>;
  readonly get: (id: string) => Promise<DraftInstance>;
}

const encodeParams = Schema.encodeEffect(DraftParams);

/** The states a round's run must run again from: it failed, or a person stopped it. */
const failed: ReadonlySet<InstanceStatus["status"]> = new Set([
  "errored",
  "terminated",
]);

/** Restarts the instance when its run failed; a running or complete one is left alone. */
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
