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
 *
 * The same Workflow admits a layer push's sealed checks (W6 609): params
 * tagged `Admission` run `admissionSteps`, so typed visibility adds no
 * Workflow binding. An admission's output is `null`.
 */
import { Outcome } from "@repo/protocol/domain/outcome";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";
import { Effect, Layer, Schema } from "effect";

import type { WorkflowParams } from "../answer-runs.ts";
import { AdmissionParams, AnswerParams } from "../answer-runs.ts";
import { decodeEnv } from "../platform.ts";
import { workerPorts } from "../ports.ts";
import { admissionSteps } from "./admission-steps.ts";
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

/** One admission's run of the Workflow over `ports`, its params decoded as an answer's are. */
export const runAdmission = <E>(
  ports: Layer.Layer<Exclude<AnswerPorts, StepRunner>, E>,
  payload: typeof AdmissionParams.Encoded,
  steps: WorkflowSteps
): Promise<null> =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* admissionSteps(
        yield* Schema.decodeEffect(AdmissionParams)(payload)
      );

      return null;
    }).pipe(
      Effect.provide(Layer.merge(ports, workflowSteps(steps))),
      Effect.orDie
    )
  );

/** Whether the engine's params start an admission rather than an answer. */
const admits = Schema.is(Schema.toEncoded(AdmissionParams));

export class Answer extends WorkflowEntrypoint<
  Env,
  typeof WorkflowParams.Encoded
> {
  /**
   * `step` is the engine's `WorkflowStep`; the run uses only its `do`
   * (`WorkflowSteps`), so a test can hand it a fake engine.
   */
  override run(
    event: Readonly<WorkflowEvent<typeof WorkflowParams.Encoded>>,
    step: WorkflowSteps
  ): Promise<OutcomeEncoded | null> {
    const ports = Layer.unwrap(Effect.map(decodeEnv(this.env), workerPorts));
    const { payload } = event;

    return admits(payload)
      ? runAdmission(ports, payload, step)
      : runWorkflow(ports, payload, step);
  }
}
