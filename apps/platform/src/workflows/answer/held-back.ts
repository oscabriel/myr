/**
 * The `Answer` Workflow's held-back step (W6; spec §5 step 7 (d)): once an
 * answer's public checks pass on the merged tree, the sealed suite its
 * claim was pinned to judges it, one bit per area (spec D17). The project
 * decides everything through `ProjectApi`: the job (`heldBackJob`, the
 * layer's files read at the pinned commit by the platform, so no layer
 * route or token reaches the sandbox), and the judgement of the area bits
 * (`recordHeldBack`: `HeldBackFailed`, `AttemptsExhausted`, or the
 * `Held-back:` trailer it keeps for the landing). Only answers whose run
 * says `sealed` take this step, so a platform without typed visibility runs
 * the same steps it always did.
 *
 * The suite runs in a job of its own, with no public lane beside it: the
 * public lanes passed in their own jobs, and answer code run again beside
 * the sealed files could carry bits about them that no attempt counts. Only
 * the area bits leave the step: no lane, no log, no duration.
 *
 * A held-back result carries over to a later check of the same request only
 * when the answer's `PatchId` and the pinned suite are unchanged (SYN §9
 * #12): a main that moved under a passing answer re-runs its public lanes
 * on the new merged tree, never its sealed suite.
 */
import { CheckAt, CheckRunner } from "@repo/checks/check-runner";
import { patchId } from "@repo/git/patch-id";
import { runBlockOf } from "@repo/project/answer-runs";
import type { AnswerRun } from "@repo/project/answer-runs";
import { noRunEnv } from "@repo/project/env-port";
import { LandingState } from "@repo/project/landing";
import { Projects } from "@repo/project/projects";
import type { HeldBackJob } from "@repo/project/visibility-port";
import { HeldBackResult } from "@repo/protocol/domain/answer";
import { PatchId, SuiteRoot } from "@repo/protocol/ids";
import type { ProjectName, RequestId, TreeSha } from "@repo/protocol/ids";
import { Refusal } from "@repo/protocol/refusal";
import { Effect, Option, Schema } from "effect";

import { StepRunner } from "../step.ts";

/** What the held-back step came to, kept as its value: area bits and roots only. */
export const HeldBackRun = Schema.TaggedUnion({
  /** The Checker could not run the suite: tried again later, never counted. */
  Blocked: { attempt: Schema.Int },
  /** The suite judged the tree: its area bits, what they earned, and what they judged. */
  Judged: {
    patchId: PatchId,
    refusals: Schema.Array(Refusal),
    results: Schema.Array(HeldBackResult),
    suite: SuiteRoot,
  },
  /** Nothing sealed judges the answer, or it no longer waits on checks of this tree. */
  Unsealed: {},
});

export type HeldBackRun = typeof HeldBackRun.Type;

/** A held-back run that judged a tree. */
export type Judged = Extract<HeldBackRun, { readonly _tag: "Judged" }>;

/** A held-back step with nothing to judge. */
export const unsealed: HeldBackRun = HeldBackRun.cases.Unsealed.make({});

/**
 * The area bits of the sealed suite on `tree`: the earlier run's when it
 * judged the same patch by the same suite, else a fresh run in a job of
 * the suite alone.
 */
const areaBits = (input: {
  readonly earlier: Option.Option<Judged>;
  readonly job: HeldBackJob;
  readonly patch: PatchId;
  readonly run: AnswerRun;
  readonly tree: TreeSha;
}) =>
  Option.match(
    Option.filter(
      input.earlier,
      ({ patchId: patched, suite }) =>
        patched === input.patch && suite === input.job.suite
    ),
    {
      onNone: () =>
        Effect.flatMap(runBlockOf(input.run), (block) =>
          CheckRunner.use((runner) =>
            runner.run({
              ...(input.run.env ?? noRunEnv),
              at: CheckAt.cases.Tree.make({ tree: input.tree }),
              heldBack: input.job,
              lanes: [],
              project: input.run.state.request.project,
              repo: input.run.state.request.fork,
              run: block,
            })
          )
        ).pipe(Effect.map(({ heldBack }) => heldBack)),
      onSome: ({ results }) => Effect.succeed(results),
    }
  );

/**
 * The sealed suite's run for one checked tree, as a durable step named for
 * the attempt: a replay reads its record back, and the project counts the
 * attempt once per tree whatever runs again (principle 8). `earlier` is
 * the last run this request's Workflow judged, which carries over to an
 * unchanged patch under an unchanged suite.
 */
export const heldBack = (
  params: { readonly project: ProjectName; readonly requestId: RequestId },
  tree: TreeSha,
  attempt: number,
  earlier: Option.Option<Judged>
): Effect.Effect<HeldBackRun, never, CheckRunner | Projects | StepRunner> =>
  Effect.flatMap(StepRunner, ({ step }) =>
    step(
      `held-back#${attempt}`,
      HeldBackRun,
      Effect.gen(function* () {
        const api = yield* Projects.use((projects) =>
          projects.get(params.project)
        ).pipe(Effect.orDie);

        const run = yield* api.answer(params.requestId);

        const checking = Option.flatMap(run, (found) =>
          LandingState.guards.Checking(found.state) && found.state.tree === tree
            ? Option.some({ found, state: found.state })
            : Option.none()
        );

        if (Option.isNone(checking)) {
          return unsealed;
        }

        const { found, state } = checking.value;
        const job = yield* api.heldBackJob(params.requestId);

        if (Option.isNone(job)) {
          return unsealed;
        }

        const patch = yield* patchId(state.changes);

        const results = yield* areaBits({
          earlier,
          job: job.value,
          patch,
          run: found,
          tree,
        }).pipe(Effect.option);

        if (Option.isNone(results)) {
          return HeldBackRun.cases.Blocked.make({ attempt: state.attempt });
        }

        return HeldBackRun.cases.Judged.make({
          patchId: patch,
          refusals: yield* api.recordHeldBack(params.requestId, results.value),
          results: results.value,
          suite: job.value.suite,
        });
      })
    )
  );
