import { Projects } from "@repo/project/projects";
/**
 * Admission of a layer push's sealed checks, as steps of the `Answer`
 * Workflow (W6 609, OSR §5.5; 615 runs them): the project plans the runs
 * (`ProjectApi.admissionPlan`: green on main k times, red on a known-bad
 * tree), the Checker runs them, and the project judges the results
 * (`recordAdmission`), moving the layer's landed SHA or leaving it.
 *
 * Until 615, the step asks for the plan and records that there is nothing
 * to admit: a project without typed visibility never has one, and a plan
 * the stub cannot run leaves the push proposed, never admitted unjudged.
 */
import { AdmissionPlan } from "@repo/project/visibility-port";
import { Effect, Option, Schema } from "effect";

import type { AdmissionParams } from "../answer-runs.ts";
import { StepRunner } from "./step.ts";

/** One admission, carried as far as the steps go now. */
export const admissionSteps = (
  params: AdmissionParams
): Effect.Effect<void, never, Projects | StepRunner> =>
  Effect.gen(function* () {
    const { step } = yield* StepRunner;

    const plan = yield* step(
      "admission:plan",
      Schema.Option(AdmissionPlan),
      Projects.use((projects) => projects.get(params.project)).pipe(
        Effect.flatMap((api) =>
          api.admissionPlan({ head: params.head, layer: params.layer })
        ),
        Effect.catchTag("UnknownProject", () => Effect.succeedNone)
      )
    );

    yield* (
      Option.isNone(plan)
        ? Effect.logInfo("nothing to admit")
        : Effect.logWarning(
            "an admission was planned, but its runs are not built: the push stays proposed"
          )
    ).pipe(Effect.annotateLogs({ head: params.head, layer: params.layer }));
  });
