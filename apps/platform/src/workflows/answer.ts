/**
 * The `Answer` Workflow: carries one admitted answer through merge, checks
 * and landing, each a durable step. The class is thin:
 * it decodes its params, runs `runAnswer` with its steps over the engine's
 * `step.do`, and hands the engine the outcome encoded as JSON. The program
 * lives in `answer/program.ts`. The class name is frozen.
 *
 * Every port comes from the Worker's env through `workerPorts`, as the
 * Worker's own ports do. The project's Durable Object is reached as the
 * platform itself: its answer queue (`answer`, `advanceAnswer`) takes no
 * caller.
 *
 * The same Workflow admits a layer push's sealed checks: params
 * tagged `Admission` run `admissionSteps`, so typed visibility adds no
 * Workflow binding. An admission's output is `null`.
 *
 * So does a round of a proposal's draft: params tagged `Draft` run
 * `draftSteps` (W9-D14), over the Worker's ports and the drafter
 * (`draftPorts`), with each step's timeout handed to the engine. A draft's
 * output is `null` too.
 */
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

/**
 * One draft round's run of the Workflow over `ports`, its params decoded
 * first, each step handed its timeout.
 */
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

/** Whether the engine's params start an admission rather than an answer. */
const admits = Schema.is(Schema.toEncoded(AdmissionParams));

/** Whether the engine's params start a draft's round. */
const drafts = Schema.is(Schema.toEncoded(DraftParams));

export class Answer extends WorkflowEntrypoint<
  Env,
  typeof WorkflowParams.Encoded
> {
  /**
   * `step` is the engine's `WorkflowStep`; the run uses only its `do`
   * (`EngineSteps`), so a test can hand it a fake engine.
   */
  override run(
    event: Readonly<WorkflowEvent<typeof WorkflowParams.Encoded>>,
    step: EngineSteps
  ): Promise<OutcomeEncoded | null> {
    const config = decodeEnv(this.env);
    const { payload } = event;

    if (drafts(payload)) {
      // The env decoded once: the Worker's ports and the drafter from it.
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
