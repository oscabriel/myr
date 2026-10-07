/**
 * The `Answer` Workflow: carries one admitted answer through merge, checks
 * and landing, each a durable step (spec §5 steps 7–8). The class is thin:
 * it decodes its params, runs `runAnswer` with its steps over the engine's
 * `step.do`, and hands the engine the outcome encoded as JSON. The program
 * lives in `answer/program.ts`. The class name is frozen.
 *
 * Every port comes from the Worker's env through `workerPorts`, as the
 * Worker's own ports do. The project's Durable Object is reached as the
 * platform itself: its answer queue (`answer`, `advanceAnswer`) takes no
 * caller.
 */
import { Outcome } from "@repo/protocol/domain/outcome";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";
import { Effect, Layer, Schema } from "effect";

import { AnswerParams } from "../answer-runs.ts";
import { decodeEnv } from "../platform.ts";
import { workerPorts } from "../ports.ts";
import { runAnswer } from "./answer/program.ts";
import type { AnswerPorts } from "./answer/program.ts";
import { workflowSteps } from "./step.ts";
import type { StepRunner, WorkflowSteps } from "./step.ts";

/** An answer's outcome as the engine keeps it: JSON. */
export const OutcomeJson = Schema.toCodecJson(Outcome);

export type OutcomeEncoded = typeof OutcomeJson.Encoded;

/**
 * One run of the Workflow over `ports`: the params decoded (a run that
 * can't decode them fails, and no step runs), the program run with its
 * steps over the engine's, and the outcome encoded.
 */
export const runWorkflow = <E>(
  ports: Layer.Layer<Exclude<AnswerPorts, StepRunner>, E>,
  payload: typeof AnswerParams.Encoded,
  steps: WorkflowSteps
): Promise<OutcomeEncoded> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const params = yield* Schema.decodeEffect(AnswerParams)(payload);
      const outcome = yield* runAnswer(params);

      return yield* Schema.encodeEffect(OutcomeJson)(outcome);
    }).pipe(
      Effect.provide(Layer.merge(ports, workflowSteps(steps))),
      Effect.orDie
    )
  );

export class Answer extends WorkflowEntrypoint<
  Env,
  typeof AnswerParams.Encoded
> {
  /**
   * `step` is the engine's `WorkflowStep`; the run uses only its `do`
   * (`WorkflowSteps`), so a test can hand it a fake engine.
   */
  override run(
    event: Readonly<WorkflowEvent<typeof AnswerParams.Encoded>>,
    step: WorkflowSteps
  ): Promise<OutcomeEncoded> {
    return runWorkflow(
      Layer.unwrap(Effect.map(decodeEnv(this.env), workerPorts)),
      event.payload,
      step
    );
  }
}
