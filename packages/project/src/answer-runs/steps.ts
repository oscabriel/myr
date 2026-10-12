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

export interface Reported {
  readonly command: LandingCommand;
  readonly report?: AnswerReport;
}

export const isStep = (effect: LandingEffect) =>
  LandingEffect.$is("Merge")(effect) ||
  LandingEffect.$is("RunChecks")(effect) ||
  LandingEffect.$is("Land")(effect);

/** A land runs only while the request holds the project's landing slot. */
export const nextSteps = (run: AnswerRun): readonly LandingEffect[] =>
  LandingState.guards.Landing(run.state) && !run.admitted
    ? []
    : pendingEffects(run.state);

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

const resultsOf = (run: CheckRun): ReadonlyMap<LaneName, LaneResult> =>
  new Map(run.lanes.map((lane) => [lane.lane, lane]));

const isTrouble = (result: LaneOutcome) =>
  result === "flaked" || result === "blocked";

const logRefOf = (requestId: RequestId, lane: LaneName) =>
  `${requestId}/${lane}`;

/** Every lane every time; a failing project lane is run on main too, since red on main is the gate's trouble. The ask's own check is red on main by design, so it passes there. */
const checks = (
  run: AnswerRun,
  checking: Extract<LandingState, { readonly _tag: "Checking" }>
): Effect.Effect<Reported, VerifierBlocked, CheckRunner> =>
  Effect.gen(function* () {
    const runner = yield* CheckRunner;
    const { request } = checking;

    const block = yield* runBlockOf(run);

    // A Checker fetches the repo a job names: the merged tree lives in the answer's fork (the merge ref), main in the project's repo.
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
