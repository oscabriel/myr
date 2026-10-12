import type { RepoHost } from "@repo/artifacts/repo-host";
import type { Drafter } from "@repo/drafting/drafter";
import { runDraft } from "@repo/drafting/run";
import type { Projects } from "@repo/project/projects";
import type { WorkflowTimeoutDuration } from "cloudflare:workers";
import type { Effect, Schema } from "effect";

import type { DraftParams } from "../answer-runs.ts";
import { StepRunner } from "./step.ts";
import type { WorkflowStepRetries, WorkflowSteps } from "./step.ts";

export const DRAFT_STEP_TIMEOUT = "10 minutes";

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

export const timedSteps = (engine: EngineSteps): WorkflowSteps => ({
  do: (name, config, body) =>
    engine.do(name, { ...config, timeout: DRAFT_STEP_TIMEOUT }, body),
});

export const draftSteps = (
  params: DraftParams
): Effect.Effect<void, never, StepRunner | Projects | Drafter | RepoHost> =>
  StepRunner.use((runner) => runDraft(params, { step: runner.step }));
