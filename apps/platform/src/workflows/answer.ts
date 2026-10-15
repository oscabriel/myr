// The class name is frozen. Params tagged `Admission` run admissions on this
// same Workflow, so they add no Workflow binding.
import { Outcome } from "@repo/protocol/domain/outcome";
import { annotateInvocation, refusedWith } from "@repo/telemetry/spans";
import type { InvocationIds } from "@repo/telemetry/spans";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";
import { Effect, Layer, Schema } from "effect";

import type { WorkflowParams } from "../answer-runs.ts";
import { AdmissionParams, AnswerParams } from "../answer-runs.ts";
import { decodeEnv } from "../platform.ts";
import { telemetryOf, workerPorts } from "../ports.ts";
import { admissionSteps } from "./admission-steps.ts";
import { runAnswer } from "./answer/program.ts";
import type { AnswerPorts } from "./answer/program.ts";
import { instance, invocation } from "./instance.ts";
import { workflowSteps } from "./step.ts";
import type { StepRunner, WorkflowSteps } from "./step.ts";

export const OutcomeJson = Schema.toCodecJson(Outcome);

export type OutcomeEncoded = typeof OutcomeJson.Encoded;

// What Issues shows beside a run that ended: the SHA it landed, or what refused it.
const outcomeIds = (outcome: Outcome): InvocationIds =>
  Outcome.match(outcome, {
    AwaitingDecision: () => ({}),
    AwaitingFinish: () => ({}),
    Checking: () => ({}),
    Landed: ({ sha }) => ({ sha }),
    Refused: ({ refusals }) => refusedWith(refusals),
    WaitingOnParent: () => ({}),
  });

export const runWorkflow = <E>(
  ports: Layer.Layer<Exclude<AnswerPorts, StepRunner>, E>,
  payload: typeof AnswerParams.Encoded,
  steps: WorkflowSteps
): Promise<OutcomeEncoded> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const params = yield* Schema.decodeEffect(AnswerParams)(payload);

      return yield* runAnswer(params).pipe(
        Effect.tap((outcome) => annotateInvocation(outcomeIds(outcome))),
        Effect.flatMap(Schema.encodeEffect(OutcomeJson)),
        invocation({ project: params.project, requestId: params.requestId })
      );
    }).pipe(
      instance("Answer.run"),
      Effect.provide(Layer.merge(ports, workflowSteps(steps))),
      Effect.orDie
    )
  );

export const runAdmission = <E>(
  ports: Layer.Layer<Exclude<AnswerPorts, StepRunner>, E>,
  payload: typeof AdmissionParams.Encoded,
  steps: WorkflowSteps
): Promise<null> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const params = yield* Schema.decodeEffect(AdmissionParams)(payload);

      return yield* admissionSteps(params).pipe(
        Effect.as(null),
        invocation({ project: params.project, sha: params.head })
      );
    }).pipe(
      instance("Admission.run"),
      Effect.provide(Layer.merge(ports, workflowSteps(steps))),
      Effect.orDie
    )
  );

const admits = Schema.is(Schema.toEncoded(AdmissionParams));

export class Answer extends WorkflowEntrypoint<
  Env,
  typeof WorkflowParams.Encoded
> {
  override run(
    event: Readonly<WorkflowEvent<typeof WorkflowParams.Encoded>>,
    step: WorkflowSteps
  ): Promise<OutcomeEncoded | null> {
    const config = decodeEnv(this.env);
    const { payload } = event;

    const ports = Layer.unwrap(
      Effect.map(config, (decoded) =>
        Layer.merge(workerPorts(decoded), telemetryOf(decoded))
      )
    );

    return admits(payload)
      ? runAdmission(ports, payload, step)
      : runWorkflow(ports, payload, step);
  }
}
