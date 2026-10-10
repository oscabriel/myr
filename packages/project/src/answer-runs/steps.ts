/**
 * An answer run's steps, as Effect programs over the ports. Each port call a
 * `LandingEffect` names becomes the `LandingCommand` that reports it: a
 * merge, the checks on the exact merged tree, or the land on main. A step
 * decides nothing: the landing lifecycle does, in the project's
 * `advanceAnswer`, and the gate classifies a failing lane.
 *
 * The inline adapter drives them in a loop (`drive`); the Answer Workflow
 * runs each as a durable step.
 */
import type { RepoHost } from "@repo/artifacts/repo-host";
import { CheckAt, CheckRunner } from "@repo/checks/check-runner";
import type { CheckLane, CheckRun } from "@repo/checks/check-runner";
import { classifyFailure } from "@repo/gate/classify";
import type { LaneOutcome, LaneResult } from "@repo/protocol/domain/answer";
import { LandedSha } from "@repo/protocol/ids";
import type { LaneName, RepoPath, RequestId } from "@repo/protocol/ids";
import type { Refusal, VerifierBlocked } from "@repo/protocol/refusal";
import { Array, Effect, Option } from "effect";

import { runBlockOf } from "../answer-runs.ts";
import type { AnswerQueue, AnswerReport, AnswerRun } from "../answer-runs.ts";
import { noRunEnv } from "../env-port.ts";
import { Lander, Rebuild } from "../lander.ts";
import {
  LandingCommand,
  LandingEffect,
  LandingState,
  pendingEffects,
} from "../landing.ts";
import { movedBy } from "./movers.ts";
import type { LandingsOf } from "./movers.ts";

/** A step's result: the command it reports, and what it saw beside it. */
export interface Reported {
  readonly command: LandingCommand;
  readonly report?: AnswerReport;
}

/** Whether an effect is a port call a run makes, rather than the project's to settle. */
export const isStep = (effect: LandingEffect) =>
  LandingEffect.$is("Merge")(effect) ||
  LandingEffect.$is("RunChecks")(effect) ||
  LandingEffect.$is("Land")(effect);

/**
 * The port calls a run makes now: the one its state waits on, except a
 * land, which runs only while the request holds the project's landing slot.
 */
export const nextSteps = (run: AnswerRun): readonly LandingEffect[] =>
  LandingState.guards.Landing(run.state) && !run.admitted
    ? []
    : pendingEffects(run.state);

/** The attempt a port's `Busy` or `Blocked` report is about: the state's own. */
const attemptOf = (state: LandingState) =>
  LandingState.matchOrElse(
    state,
    {
      Checking: ({ attempt }) => attempt,
      Landing: ({ attempt }) => attempt,
      Merging: ({ attempt }) => attempt,
    },
    () => 0
  );

const reported = (command: LandingCommand, report?: AnswerReport): Reported =>
  report === undefined ? { command } : { command, report };

/**
 * The answer's head merged onto `main`: the tree to check, or the paths
 * that conflict, with the landing that last moved each one (`movedBy`).
 */
const merge = (
  run: AnswerRun,
  step: Extract<LandingEffect, { readonly _tag: "Merge" }>,
  landings: LandingsOf
) =>
  Lander.use((lander) =>
    lander.merge({
      base: step.base,
      fork: step.fork,
      head: step.head,
      main: step.main,
      repo: run.repo,
    })
  ).pipe(
    Effect.map(({ changes, tree }) =>
      reported(LandingCommand.Merged({ changes, main: step.main, tree }))
    ),
    Effect.catchTags({
      StaleBase: ({ conflicts }) =>
        Effect.map(
          movedBy(
            { base: step.base, conflicts, main: step.main, repo: run.repo },
            landings
          ),
          (moved) =>
            reported(
              Array.isReadonlyArrayNonEmpty(moved)
                ? LandingCommand.MergeConflict({
                    conflicts,
                    main: step.main,
                    movedBy: moved,
                  })
                : LandingCommand.MergeConflict({ conflicts, main: step.main })
            )
        ),
      VerifierBlocked: () =>
        Effect.succeed(
          reported(LandingCommand.Blocked({ attempt: attemptOf(run.state) }))
        ),
    })
  );

/** Each lane's result in a run, by lane. */
const resultsOf = (run: CheckRun): ReadonlyMap<LaneName, LaneResult> =>
  new Map(run.lanes.map((lane) => [lane.lane, lane]));

const isTrouble = (result: LaneOutcome) =>
  result === "flaked" || result === "blocked";

/** Where a lane's log is kept when its run named no place: by request and lane. */
const logRefOf = (requestId: RequestId, lane: LaneName) =>
  `${requestId}/${lane}`;

/**
 * The checks on the exact merged tree, every lane every time. A lane that
 * did not pass is classified by the gate: a checker that never started gets
 * one fresh run, and a project lane is run on main too, since a lane red on
 * main is the gate's trouble, not the answer's. The ask's own check is red
 * on main by design, so it counts as passing there.
 */
const checks = (
  run: AnswerRun,
  checking: Extract<LandingState, { readonly _tag: "Checking" }>
): Effect.Effect<Reported, VerifierBlocked, CheckRunner> =>
  Effect.gen(function* () {
    const runner = yield* CheckRunner;
    const { request } = checking;

    const block = yield* runBlockOf(run);

    // The merged tree lives in the answer's fork, where the Lander's merge
    // leaves it (its merge ref), and main in the project's own repo: a
    // Checker fetches the repo a job names, so each job names the one that
    // holds its commit, as the `Answer` Workflow's jobs do.
    const job = (at: CheckAt, lanes: readonly CheckLane[]) =>
      runner.run({
        ...(run.env ?? noRunEnv),
        at,
        lanes,
        project: request.project,
        repo: CheckAt.guards.Tree(at) ? request.fork : run.repo,
        run: block,
      });

    const lanesNamed = (names: ReadonlySet<LaneName>) =>
      run.lanes.filter(({ lane }) => names.has(lane));

    const onTree = CheckAt.cases.Tree.make({ tree: checking.tree });
    const merged = yield* job(onTree, run.lanes);
    const failing = merged.lanes.filter(({ result }) => result !== "passed");

    const troubled = new Set(
      failing.filter(({ result }) => isTrouble(result)).map(({ lane }) => lane)
    );

    const onMainNeeded = new Set(
      failing.map(({ lane }) => lane).filter((lane) => lane !== run.askLane)
    );

    const rerun =
      troubled.size === 0
        ? new Map<LaneName, LaneResult>()
        : resultsOf(yield* job(onTree, lanesNamed(troubled)));

    const onMain =
      onMainNeeded.size === 0
        ? new Map<LaneName, LaneResult>()
        : resultsOf(
            yield* job(
              CheckAt.cases.Commit.make({ commit: checking.main }),
              lanesNamed(onMainNeeded)
            )
          );

    const changed = new Set<RepoPath>(checking.changes.map(({ path }) => path));

    const refusals = Array.getSomes(
      failing.map((lane) =>
        classifyFailure(
          {
            command: lane.command,
            failingPaths: [],
            isDoctor: false,
            lane: lane.lane,
            logRef: lane.logRef ?? logRefOf(request.requestId, lane.lane),
            onMain: onMainNeeded.has(lane.lane)
              ? (onMain.get(lane.lane)?.result ?? "blocked")
              : "passed",
            onMerged: lane.result,
            rerun: Option.map(
              Option.fromUndefinedOr(rerun.get(lane.lane)),
              ({ result }) => result
            ),
          },
          changed,
          { base: request.base, main: checking.main }
        )
      )
    );

    const lanes = merged.lanes.map((lane) => rerun.get(lane.lane) ?? lane);

    return reported(
      LandingCommand.Checked({
        decisions: [],
        finish: run.finish,
        refusals: refusals satisfies readonly Refusal[],
        tree: checking.tree,
      }),
      { heldBack: merged.heldBack, lanes }
    );
  });

/**
 * The checked tree landed on main as the platform's commit, with the
 * message the project wrote. A moved main sends it back to merge; a busy
 * repo or a blocked Lander waits and tries again.
 */
const land = (
  run: AnswerRun,
  landing: Extract<LandingState, { readonly _tag: "Landing" }>,
  message: string
) =>
  Lander.use((lander) =>
    lander.land({
      author: landing.request.answerer,
      main: landing.main,
      message,
      rebuild: Rebuild.Merge({
        base: landing.request.base,
        fork: landing.request.fork,
        head: landing.request.head,
      }),
      repo: run.repo,
      requestId: landing.request.requestId,
      tree: landing.tree,
      verdict: Option.fromUndefinedOr(run.verdict),
    })
  ).pipe(
    Effect.map(({ pending, sha }) =>
      reported(
        LandingCommand.LandedOk({ sha }),
        Array.isReadonlyArrayNonEmpty(pending) ? { pending } : undefined
      )
    ),
    Effect.catchTags({
      RepoBusy: () =>
        Effect.succeed(
          reported(LandingCommand.Busy({ attempt: landing.attempt }))
        ),
      StaleBase: ({ main }) =>
        Effect.succeed(
          reported(
            LandingCommand.MainMoved({
              from: landing.main,
              main: LandedSha.make(main),
            })
          )
        ),
      VerifierBlocked: () =>
        Effect.succeed(
          reported(LandingCommand.Blocked({ attempt: landing.attempt }))
        ),
    })
  );

/**
 * One step: the port call `effect` names, run for `run`, and the command
 * that reports it. `None` when the run's state no longer waits on that call
 * (a replay after the state moved on). A merge that conflicts asks
 * `landings` who moved each path.
 */
export const runStep = (
  run: AnswerRun,
  effect: LandingEffect,
  landings: LandingsOf
): Effect.Effect<
  Option.Option<Reported>,
  never,
  CheckRunner | Lander | RepoHost
> =>
  LandingEffect.$match(effect, {
    Emit: () => Effect.succeedNone,
    Land: () =>
      LandingState.guards.Landing(run.state) && run.message !== undefined
        ? Effect.asSome(land(run, run.state, run.message))
        : Effect.succeedNone,
    Merge: (merging) => Effect.asSome(merge(run, merging, landings)),
    Record: () => Effect.succeedNone,
    Retry: () => Effect.succeedNone,
    RunChecks: () =>
      LandingState.guards.Checking(run.state)
        ? checks(run, run.state).pipe(
            Effect.catchTag("VerifierBlocked", () =>
              Effect.succeed(
                reported(
                  LandingCommand.Blocked({ attempt: attemptOf(run.state) })
                )
              )
            ),
            Effect.asSome
          )
        : Effect.succeedNone,
  });

/**
 * Carries one answer as far as it goes now: runs the step its state waits
 * on, reports it, and goes on with the steps the report returns, until the
 * answer lands, is refused, waits on a person or the queue, or must wait for
 * a retry (the project's alarm starts it again).
 */
export const drive = (
  queue: AnswerQueue,
  requestId: RequestId
): Effect.Effect<void, never, CheckRunner | Lander | RepoHost> => {
  const go = (
    steps: readonly LandingEffect[]
  ): Effect.Effect<void, never, CheckRunner | Lander | RepoHost> =>
    Effect.gen(function* () {
      const effect = steps.find(isStep);

      if (effect === undefined || steps.some(LandingEffect.$is("Retry"))) {
        return;
      }

      const run = yield* queue.answer(requestId);

      if (Option.isNone(run)) {
        return;
      }

      const step = yield* runStep(run.value, effect, queue.landings);

      if (Option.isNone(step)) {
        return;
      }

      const advanced = yield* queue.advanceAnswer(
        requestId,
        step.value.command,
        step.value.report
      );

      yield* go(advanced.effects);
    });

  return Effect.flatMap(queue.answer(requestId), (run) =>
    Option.match(run, {
      onNone: () => Effect.void,
      onSome: (found) => go(nextSteps(found)),
    })
  );
};
