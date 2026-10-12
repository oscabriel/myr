// The class name is frozen. Params tagged `Admission` or `Draft` run admissions and
// draft rounds on this same Workflow, so neither adds a Workflow binding.
import type { RepoHost } from "@repo/artifacts/repo-host";
import type { Drafter } from "@repo/drafting/drafter";
import type { Projects } from "@repo/project/projects";
import { Outcome } from "@repo/protocol/domain/outcome";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";
import { Effect, Layer, Schema } from "effect";

import type { WorkflowParams } from "../answer-runs.ts";
import { AdmissionParams, AnswerParams, DraftParams } from "../answer-runs.ts";
import { decodeEnv } from "../platform.ts";
import { draftPorts, workerPorts } from "../ports.ts";
import { admissionSteps } from "./admission-steps.ts";
import { runAnswer } from "./answer/program.ts";
import type { AnswerPorts } from "./answer/program.ts";
import { draftSteps, timedSteps } from "./draft-steps.ts";
import type { EngineSteps } from "./draft-steps.ts";
import { workflowSteps } from "./step.ts";
import type { StepRunner, WorkflowSteps } from "./step.ts";

export const OutcomeJson = Schema.toCodecJson(Outcome);

export type OutcomeEncoded = typeof OutcomeJson.Encoded;

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

export const runDraftWorkflow = <E>(
  ports: Layer.Layer<Projects | Drafter | RepoHost, E>,
  payload: typeof DraftParams.Encoded,
  steps: EngineSteps
): Promise<null> =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* draftSteps(yield* Schema.decodeEffect(DraftParams)(payload));

      return null;
    }).pipe(
      Effect.provide(Layer.merge(ports, workflowSteps(timedSteps(steps)))),
      Effect.orDie
    )
  );

const admits = Schema.is(Schema.toEncoded(AdmissionParams));

const drafts = Schema.is(Schema.toEncoded(DraftParams));

export class Answer extends WorkflowEntrypoint<
  Env,
  typeof WorkflowParams.Encoded
> {
  override run(
    event: Readonly<WorkflowEvent<typeof WorkflowParams.Encoded>>,
    step: EngineSteps
  ): Promise<OutcomeEncoded | null> {
    const config = decodeEnv(this.env);
    const { payload } = event;

    if (drafts(payload)) {
      return runDraftWorkflow(
        Layer.unwrap(
          Effect.map(config, (decoded) =>
            Layer.merge(workerPorts(decoded), draftPorts(decoded))
          )
        ),
        payload,
        step
      );
    }

    const ports = Layer.unwrap(Effect.map(config, workerPorts));

    return admits(payload)
      ? runAdmission(ports, payload, step)
      : runWorkflow(ports, payload, step);
  }
}
