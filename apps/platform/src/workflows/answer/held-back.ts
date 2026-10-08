/**
 * The `Answer` Workflow's held-back step (W6 609; spec §5 step 7 (d)): once
 * an answer's public checks pass on the merged tree, the sealed suite its
 * claim was pinned to judges it, one bit per area (spec D17). The project
 * decides everything through `ProjectApi`: the job (`heldBackJob`, the
 * layer's files read at the pinned commit), and the judgement of the area
 * bits (`recordHeldBack`: `HeldBackFailed`, `AttemptsExhausted`, or the
 * `Held-back:` trailer it keeps for the landing). Only answers whose run
 * says `sealed` take this step, so a platform without typed visibility runs
 * the same steps it always did.
 *
 * Until the Checker takes a sealed suite (605 reshapes the `CheckJob`'s
 * held-back part, 613 fills it here), an answer the project holds a suite
 * for is refused `VerifierBlocked` rather than landed unjudged by it.
 */
import { Projects } from "@repo/project/projects";
import { HeldBackResult } from "@repo/protocol/domain/answer";
import type { ProjectName, RequestId } from "@repo/protocol/ids";
import { Refusal, VerifierBlocked } from "@repo/protocol/refusal";
import { Effect, Option, Schema } from "effect";

import { StepRunner } from "../step.ts";

/** What the held-back step came to: the refusals it earned, and the area bits for the verdict. */
export const HeldBackRun = Schema.Struct({
  refusals: Schema.Array(Refusal),
  results: Schema.Array(HeldBackResult),
});

export type HeldBackRun = typeof HeldBackRun.Type;

/** A held-back step with nothing to judge. */
export const unsealed: HeldBackRun = { refusals: [], results: [] };

/**
 * The sealed suite's run for one checked tree, as a durable step named for
 * the attempt: a replay reads its record back, and the project counts the
 * attempt once per tree whatever runs again.
 */
export const heldBack = (
  params: { readonly project: ProjectName; readonly requestId: RequestId },
  attempt: number
): Effect.Effect<HeldBackRun, never, Projects | StepRunner> =>
  Effect.flatMap(StepRunner, ({ step }) =>
    step(
      `held-back#${attempt}`,
      HeldBackRun,
      Effect.gen(function* () {
        const api = yield* Projects.use((projects) =>
          projects.get(params.project)
        ).pipe(Effect.orDie);

        const job = yield* api.heldBackJob(params.requestId);

        return Option.match(job, {
          onNone: () => unsealed,
          onSome: (): HeldBackRun => ({
            refusals: [new VerifierBlocked({})],
            results: [],
          }),
        });
      })
    )
  );
