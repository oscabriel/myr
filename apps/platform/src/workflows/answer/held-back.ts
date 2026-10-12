// The layer's files are read by the platform, so no layer route or token reaches the
// sandbox.
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

export const HeldBackRun = Schema.TaggedUnion({
  Blocked: { attempt: Schema.Int },
  Judged: {
    patchId: PatchId,
    refusals: Schema.Array(Refusal),
    results: Schema.Array(HeldBackResult),
    suite: SuiteRoot,
  },
  Unsealed: {},
});

export type HeldBackRun = typeof HeldBackRun.Type;

export type Judged = Extract<HeldBackRun, { readonly _tag: "Judged" }>;

export const unsealed: HeldBackRun = HeldBackRun.cases.Unsealed.make({});

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
