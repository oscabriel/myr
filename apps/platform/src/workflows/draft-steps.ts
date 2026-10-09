/**
 * One round of a proposal's draft, as steps of the `Answer` Workflow
 * (ADR 0018): the program is `@repo/drafting/run`'s `runDraft`, shared with
 * the in-process run, over the Workflow's `StepRunner`. Its steps are
 * `context`, then `draft-<n>` and `rehearse-<n>` per attempt, then
 * `settle`, inside the instance `draft-<project>-<proposal>-r<round>`.
 *
 * The engine is handed a timeout with each of the run's steps
 * (`timedSteps`): a model call or a rehearsal on a cold Checker takes
 * minutes, and the other two steps are one Durable Object call each, well
 * inside the same bound.
 */
import type { RepoHost } from "@repo/artifacts/repo-host";
import type { Drafter } from "@repo/drafting/drafter";
import { runDraft } from "@repo/drafting/run";
import type { Projects } from "@repo/project/projects";
import type { WorkflowTimeoutDuration } from "cloudflare:workers";
import type { Effect, Schema } from "effect";

import type { DraftParams } from "../answer-runs.ts";
import { StepRunner } from "./step.ts";
import type { WorkflowStepRetries, WorkflowSteps } from "./step.ts";

/** How long one step of a draft's run may take before the engine fails it. */
export const DRAFT_STEP_TIMEOUT = "10 minutes";

/**
 * The part of a Workflow's `WorkflowStep` a draft's run uses: `do`, with
 * retries and a timeout. A `WorkflowStep` is one, and so is anything that
 * takes `WorkflowSteps`' narrower config.
 */
export interface EngineSteps {
  readonly do: (
    name: string,
    config: {
      readonly retries?: WorkflowStepRetries;
      readonly timeout?: WorkflowTimeoutDuration;
    },
    body: () => Promise<Schema.Json>
  ) => Promise<Schema.Json>;
}

/** The engine's steps, each handed the draft step timeout. */
export const timedSteps = (engine: EngineSteps): WorkflowSteps => ({
  do: (name, config, body) =>
    engine.do(name, { ...config, timeout: DRAFT_STEP_TIMEOUT }, body),
});

/** One round of a draft, carried from its context to its settling. */
export const draftSteps = (
  params: DraftParams
): Effect.Effect<void, never, StepRunner | Projects | Drafter | RepoHost> =>
  StepRunner.use((runner) => runDraft(params, { step: runner.step }));
