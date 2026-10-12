// Steps record only the plan's outline and each run's area bits, never a check's
// file, path or name: the sealed files go from the project to the Checker alone.
import { CheckAt, CheckRunner } from "@repo/checks/check-runner";
import { noRunEnv } from "@repo/project/env-port";
import { Projects } from "@repo/project/projects";
import { AdmissionRun } from "@repo/project/visibility-port";
import type { AdmissionPlan } from "@repo/project/visibility-port";
import { HeldBackResult } from "@repo/protocol/domain/answer";
import {
  AreaName,
  CommitSha,
  keyOf,
  LandedSha,
  RepoName,
} from "@repo/protocol/ids";
import { Array as Arr, Effect, Option, Schema } from "effect";

import type { AdmissionParams } from "../answer-runs.ts";
import { StepRunner } from "./step.ts";
import type { StepRetry } from "./step.ts";

const RunRef = Schema.TaggedUnion({
  OnKnownBad: { area: AreaName, tree: CommitSha },
  OnMain: { area: AreaName, attempt: Schema.Int },
});

type RunRef = typeof RunRef.Type;

const Outline = Schema.Struct({
  main: LandedSha,
  runs: Schema.Array(RunRef),
});

type Outline = typeof Outline.Type;

const Ran = Schema.TaggedUnion({
  Bits: { areas: Schema.Array(HeldBackResult) },
  Gone: {},
});

type Ran = typeof Ran.Type;

const admissionRetry: StepRetry = {
  backoff: "exponential",
  delayMs: 10_000,
  limit: 3,
};

const RUNS_AT_ONCE = 4;

const refOf = (run: AdmissionRun): RunRef =>
  AdmissionRun.guards.OnMain(run)
    ? RunRef.cases.OnMain.make({ area: run.area, attempt: run.attempt })
    : RunRef.cases.OnKnownBad.make({ area: run.area, tree: run.tree });

const nameOf = (ref: RunRef) =>
  RunRef.match(ref, {
    OnKnownBad: ({ area, tree }) => `admission:${area}:known-bad:${tree}`,
    OnMain: ({ area, attempt }) => `admission:${area}:main#${attempt}`,
  });

export const admissionSteps = (
  params: AdmissionParams
): Effect.Effect<void, never, CheckRunner | Projects | StepRunner> =>
  Effect.gen(function* () {
    const { step } = yield* StepRunner;
    const runner = yield* CheckRunner;
    const projects = yield* Projects;

    const planNow = projects.get(params.project).pipe(
      Effect.flatMap((api) =>
        api.admissionPlan({ head: params.head, layer: params.layer })
      ),
      Effect.catchTag("UnknownProject", () =>
        Effect.succeed(Option.none<AdmissionPlan>())
      )
    );

    const outline = yield* step(
      "admission:plan",
      Schema.Option(Outline),
      Effect.map(planNow, (plan) =>
        Option.map(plan, ({ main, runs }): Outline => ({
          main,
          runs: runs.map(refOf),
        }))
      )
    );

    if (Option.isNone(outline)) {
      yield* Effect.logInfo("nothing to admit");

      return;
    }

    const { main } = outline.value;

    const runOne = (ref: RunRef) =>
      step(
        nameOf(ref),
        Ran,
        Effect.gen(function* () {
          const plan = yield* planNow;

          const found = Option.flatMap(plan, ({ runs }) =>
            Arr.findFirst(runs, (run) => nameOf(refOf(run)) === nameOf(ref))
          );

          if (Option.isNone(plan) || Option.isNone(found)) {
            return Ran.cases.Gone.make({});
          }

          const ran = yield* runner.run({
            ...noRunEnv,
            at: CheckAt.cases.Commit.make({ commit: CommitSha.make(main) }),
            heldBack: found.value.job,
            lanes: [],
            project: params.project,
            repo: RepoName.make(keyOf(params.project)),
            run: plan.value.run,
          });

          return Ran.cases.Bits.make({ areas: ran.heldBack });
        }),
        admissionRetry
      ).pipe(Effect.option);

    const ran = yield* Effect.forEach(
      outline.value.runs,
      (ref) =>
        Effect.map(runOne(ref), (result) => [nameOf(ref), result] as const),
      { concurrency: RUNS_AT_ONCE }
    );

    if (ran.some(([, result]) => Option.isNone(result))) {
      yield* Effect.logWarning(
        "the Checker could not run an admission's checks: the push stays proposed"
      );

      return;
    }

    const bits = new Map(
      ran.flatMap(([name, result]) =>
        Option.match(result, {
          onNone: () => [],
          onSome: (each) =>
            Ran.guards.Bits(each) ? [[name, each.areas] as const] : [],
        })
      )
    );

    yield* step(
      "admission:judge",
      Schema.Boolean,
      Effect.gen(function* () {
        const plan = yield* planNow;

        if (Option.isNone(plan)) {
          return false;
        }

        const api = yield* Effect.orDie(projects.get(params.project));

        yield* api.recordAdmission({
          head: params.head,
          layer: params.layer,
          results: plan.value.runs.flatMap((run) =>
            Option.match(Option.fromUndefinedOr(bits.get(nameOf(refOf(run)))), {
              onNone: () => [],
              onSome: (areas) => [{ areas, run }],
            })
          ),
        });

        return true;
      })
    );
  }).pipe(Effect.annotateLogs({ head: params.head, layer: params.layer }));
