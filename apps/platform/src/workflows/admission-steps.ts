/**
 * Admission of a layer push's held-back checks, as steps of the `Answer`
 * Workflow: the project plans the runs
 * (`ProjectApi.admissionPlan`: each changed area's checks green on main k
 * times, red on each known-bad tree its manifest names), the Checker runs
 * each, and the project judges the area bits (`recordAdmission`), moving
 * the layer's landed SHA under a fresh commitment, or leaving it.
 *
 * Every step is durable, named for what it runs, inside the instance
 * `admit-<project>-<layer>-<head>`: a replay reads each recorded value back,
 * and the project's judgement changes nothing once the head is no longer
 * proposed (principle 8). What the steps record is the plan's outline (the
 * main it runs on, and each run by area and attempt or tree) and each
 * run's area bits: never a check's file, path or name. Each step asks the
 * project for the plan again and runs the planned job it names, so the
 * sealed files go from the project to the Checker and nowhere else.
 *
 * Each job runs on main as the plan found it, in the project's own repo,
 * with no public lane beside the held-back checks, and with no env: no
 * placeholder, no proxy, no value. A Checker that stays blocked through a
 * step's retries leaves the push proposed, unjudged.
 */
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

/** A planned run, by what names it in its plan: its area, and main's attempt or the known-bad tree. */
const RunRef = Schema.TaggedUnion({
  OnKnownBad: { area: AreaName, tree: CommitSha },
  OnMain: { area: AreaName, attempt: Schema.Int },
});

type RunRef = typeof RunRef.Type;

/** What the plan step records: the main every run checks out, and each run by reference. */
const Outline = Schema.Struct({
  main: LandedSha,
  runs: Schema.Array(RunRef),
});

type Outline = typeof Outline.Type;

/** What one run's step records: its area bits, or that its plan is gone (the head moved on). */
const Ran = Schema.TaggedUnion({
  Bits: { areas: Schema.Array(HeldBackResult) },
  Gone: {},
});

type Ran = typeof Ran.Type;

/** How a run step retries a Checker that could not run, before the push is left unjudged. */
const admissionRetry: StepRetry = {
  backoff: "exponential",
  delayMs: 10_000,
  limit: 3,
};

/** How many runs go to the Checker at once. */
const RUNS_AT_ONCE = 4;

/** A planned run, by reference: no job, so no file. */
const refOf = (run: AdmissionRun): RunRef =>
  AdmissionRun.guards.OnMain(run)
    ? RunRef.cases.OnMain.make({ area: run.area, attempt: run.attempt })
    : RunRef.cases.OnKnownBad.make({ area: run.area, tree: run.tree });

/** A run's step name, and its identity within its plan. */
const nameOf = (ref: RunRef) =>
  RunRef.match(ref, {
    OnKnownBad: ({ area, tree }) => `admission:${area}:known-bad:${tree}`,
    OnMain: ({ area, attempt }) => `admission:${area}:main#${attempt}`,
  });

/** One admission of a layer push, carried from its plan to its judgement. */
export const admissionSteps = (
  params: AdmissionParams
): Effect.Effect<void, never, CheckRunner | Projects | StepRunner> =>
  Effect.gen(function* () {
    const { step } = yield* StepRunner;
    const runner = yield* CheckRunner;
    const projects = yield* Projects;

    /** The project's plan as it stands now; none once nothing waits to be admitted. */
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

    /** One planned run, in the Checker: the plan asked for again, and the job it names run on main. */
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
