// The merged tree is checked in the answer's fork, where `Lander.merge` keeps it, so a
// merge needs no write token on the canonical repo.
import {
  CheckAt,
  CheckLane,
  CheckRunner,
  outputOf,
} from "@repo/checks/check-runner";
import type { CheckRun, LaneEvidence } from "@repo/checks/check-runner";
import { EvidenceStore } from "@repo/checks/evidence-store";
import { lintToZeroCount } from "@repo/checks/kinds/lint-to-zero";
import { countLanes, measure } from "@repo/checks/kinds/ratchet";
import { classifyFailure } from "@repo/gate/classify";
import { MeasuredCount, runBlockOf } from "@repo/project/answer-runs";
import type { AnswerRun } from "@repo/project/answer-runs";
import { noRunEnv, UnlandedRunEnv } from "@repo/project/env-port";
import { LandingState } from "@repo/project/landing";
import { Projects } from "@repo/project/projects";
import { LaneOutcome, LaneResult } from "@repo/protocol/domain/answer";
import { CheckSpec } from "@repo/protocol/domain/check";
import { AskKind } from "@repo/protocol/domain/kind";
import { RunBlock } from "@repo/protocol/domain/run";
import {
  CommitSha,
  LandedSha,
  LaneName,
  ProjectName,
  RatchetName,
  RepoName,
  RepoPath,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import { ChecksFailed } from "@repo/protocol/refusal";
import type { Flake, StaleBase, VerifierBlocked } from "@repo/protocol/refusal";
import { Array, Effect, Option, Order, Result, Schema } from "effect";

export const cheapLanes = ["format", "lint", "types"] as const;

export type Stage = "cheap" | "checks";

const isCheap = (lane: LaneName) =>
  cheapLanes.some((name): boolean => name === lane);

export const lanesFor = (run: AnswerRun, stage: Stage): readonly CheckLane[] =>
  run.lanes.filter(
    ({ lane }) =>
      (stage === "cheap") === (isCheap(lane) && lane !== run.askLane)
  );

export const Checked = Schema.Struct({
  askLane: Schema.optionalKey(LaneName),
  attempt: Schema.Int,
  base: CommitSha,
  changed: Schema.Array(RepoPath),
  env: Schema.optionalKey(UnlandedRunEnv),
  finish: AskKind.fields.finish,
  fork: RepoName,
  main: LandedSha,
  project: ProjectName,
  repo: RepoName,
  requestId: RequestId,
  run: Schema.optionalKey(RunBlock),
  sealed: Schema.optionalKey(Schema.Boolean),
  tree: TreeSha,
});

export type Checked = typeof Checked.Type;

export const LaneRun = Schema.Struct({
  check: CheckLane,
  failingPaths: Schema.Array(RepoPath),
  first: LaneOutcome,
  rerun: Schema.optionalKey(LaneOutcome),
  result: LaneResult,
});

export type LaneRun = typeof LaneRun.Type;

export const StageRun = Schema.TaggedUnion({
  Blocked: { attempt: Schema.Int },
  Moved: {},
  Ran: {
    checked: Checked,
    counts: Schema.optionalKey(Schema.Array(MeasuredCount)),
    lanes: Schema.Array(LaneRun),
    uncounted: Schema.optionalKey(RatchetName),
  },
});

export type StageRun = typeof StageRun.Type;

type Ran = Extract<StageRun, { readonly _tag: "Ran" }>;

// The extension starts with a letter, so an address and port (`127.0.0.1:8080`) is no file.
const LOCATION =
  /(?<![\w./@+-])(?<path>(?:[\w@+-][\w.@+-]*\/)*[\w@+-][\w.@+-]*\.[A-Za-z][A-Za-z0-9]*):\d+/gu;

const TEST_FILE =
  /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[A-Za-z0-9]+$/u;

export const failingPathsOf = (output: string): readonly RepoPath[] =>
  Array.sort(
    Array.dedupe(
      [...output.matchAll(LOCATION)].flatMap(({ groups }) =>
        groups?.path === undefined || TEST_FILE.test(groups.path)
          ? []
          : [groups.path]
      )
    ),
    Order.String
  ).map((path) => RepoPath.make(path));

export const laneLog = (
  result: LaneResult,
  evidence: Option.Option<LaneEvidence>
): string =>
  [
    `${result.lane}: ${result.result} in ${result.durationMs} ms`,
    `$ ${result.command}`,
    ...Option.toArray(
      Option.flatMap(evidence, ({ signature }) =>
        Option.fromUndefinedOr(signature)
      )
    ),
    ...Option.toArray(
      Option.flatMap(evidence, ({ weakness }) =>
        Option.fromUndefinedOr(weakness)
      )
    ),
  ].join("\n");

export const { withheld } = ChecksFailed;

const isTrouble = (result: LaneOutcome) =>
  result === "flaked" || result === "blocked";

interface ByLane {
  readonly evidence: ReadonlyMap<LaneName, LaneEvidence>;
  readonly results: ReadonlyMap<LaneName, LaneResult>;
}

const byLane = (run: CheckRun): ByLane => ({
  evidence: new Map(run.evidence.map((each) => [each.lane, each])),
  results: new Map(run.lanes.map((each) => [each.lane, each])),
});

const noRun: ByLane = { evidence: new Map(), results: new Map() };

interface Standing {
  readonly check: CheckLane;
  readonly first: LaneResult;
  readonly again: Option.Option<LaneResult>;
  readonly stands: LaneResult;
  readonly said: Option.Option<LaneEvidence>;
}

const standingOf = (
  lane: CheckLane,
  first: ByLane,
  fresh: ByLane
): Standing => {
  const began = first.results.get(lane.lane) ?? {
    command: lane.command,
    durationMs: 0,
    lane: lane.lane,
    result: "blocked",
  };

  const again = Option.fromUndefinedOr(fresh.results.get(lane.lane));

  return {
    again,
    check: lane,
    first: began,
    said: Option.fromUndefinedOr(
      (Option.isSome(again) ? fresh : first).evidence.get(lane.lane)
    ),
    stands: Option.getOrElse(again, () => began),
  };
};

const laneRunOf = (checked: Checked, standing: Standing): LaneRun => {
  const signature = Option.getOrElse(
    Option.flatMap(standing.said, ({ signature: said }) =>
      Option.fromUndefinedOr(said)
    ),
    () => ""
  );

  const judged: LaneRun = {
    check: standing.check,
    failingPaths:
      standing.first.lane === checked.askLane ? [] : failingPathsOf(signature),
    first: standing.first.result,
    result: standing.stands,
  };

  return Option.match(standing.again, {
    onNone: () => judged,
    onSome: ({ result }) => ({ ...judged, rerun: result }),
  });
};

const checkedOf = (run: AnswerRun, tree: TreeSha): Option.Option<Checked> => {
  const { state } = run;

  if (!LandingState.guards.Checking(state) || state.tree !== tree) {
    return Option.none();
  }

  const { request } = state;

  const checked = {
    attempt: state.attempt,
    base: request.base,
    changed: state.changes.map(({ path }) => path),
    finish: run.finish,
    fork: request.fork,
    main: state.main,
    project: request.project,
    repo: run.repo,
    requestId: request.requestId,
    tree: state.tree,
  };

  const asked =
    run.askLane === undefined ? checked : { ...checked, askLane: run.askLane };

  const blocked = run.run === undefined ? asked : { ...asked, run: run.run };

  const carried =
    run.env === undefined ? blocked : { ...blocked, env: run.env };

  return Option.some(
    run.sealed === true ? { ...carried, sealed: true } : carried
  );
};

const withLane = (
  ran: CheckRun,
  result: LaneResult,
  evidence: Option.Option<LaneEvidence>
): CheckRun => ({
  ...ran,
  evidence: [
    ...ran.evidence.filter(({ lane }) => lane !== result.lane),
    ...Option.toArray(evidence),
  ],
  lanes: ran.lanes.map((each) => (each.lane === result.lane ? result : each)),
});

// A lint with findings anywhere exits 1, so its exit code says nothing here.
const countedAskLane = (
  run: AnswerRun,
  ran: CheckRun
): Effect.Effect<CheckRun> => {
  const { ask, askLane } = run;

  const result = ran.lanes.find(({ lane }) => lane === askLane);

  if (
    ask === undefined ||
    askLane === undefined ||
    !CheckSpec.guards.LintToZero(ask.check) ||
    result === undefined ||
    isTrouble(result.result)
  ) {
    return Effect.succeed(ran);
  }

  const { check } = ask;

  return Effect.fromOption(outputOf(ran, askLane)).pipe(
    Effect.flatMap((stdout) =>
      lintToZeroCount({
        asked: ask.territory,
        check,
        modules: run.counts?.modules ?? [],
        stdout,
      })
    ),
    Effect.map((count) =>
      count === 0
        ? withLane(ran, { ...result, result: "passed" }, Option.none())
        : withLane(
            ran,
            { ...result, result: "failed" },
            Option.some({
              lane: askLane,
              signature: `${check.rule}: ${count} in ${check.territory ?? ask.territory.module}`,
            })
          )
    ),
    Effect.orElseSucceed(() =>
      withLane(
        ran,
        { ...result, result: "loadError" },
        Option.some({ lane: askLane })
      )
    )
  );
};

interface Counted {
  readonly counts: readonly MeasuredCount[];
  readonly uncounted: Option.Option<RatchetName>;
}

/** What the lane running a command printed, or nothing. */
const printedBy =
  (lanes: readonly CheckLane[], ran: CheckRun) => (command: string) =>
    Option.getOrElse(
      Option.flatMap(
        Option.fromUndefinedOr(lanes.find((lane) => lane.command === command)),
        ({ lane }) => outputOf(ran, lane)
      ),
      () => ""
    );

/** The ratchets' counts, read from the lanes a run printed. */
const countRatchets = (
  run: AnswerRun,
  lanes: readonly CheckLane[],
  ran: CheckRun
): Effect.Effect<Counted> =>
  Effect.gen(function* () {
    const specs = run.counts?.ratchets ?? [];

    if (!Array.isReadonlyArrayNonEmpty(specs)) {
      return { counts: [], uncounted: Option.none() };
    }

    const printed = printedBy(lanes, ran);

    const counts = yield* Effect.forEach(specs, (spec) =>
      measure(
        spec,
        (command) => Effect.succeed({ code: 0, stdout: printed(command) }),
        run.counts?.modules ?? []
      ).pipe(Effect.mapError(() => spec.name))
    ).pipe(Effect.result);

    return Result.match(counts, {
      onFailure: (name) => ({ counts: [], uncounted: Option.some(name) }),
      onSuccess: (all) => ({ counts: all.flat(), uncounted: Option.none() }),
    });
  });

/** The ratchets' lanes, counted in the cheap stage. */
const countingLanesOf = (run: AnswerRun, stage: Stage): readonly CheckLane[] =>
  stage === "cheap" && run.counts !== undefined
    ? countLanes(run.counts.ratchets)
    : [];

const namesApart = (
  lanes: readonly CheckLane[],
  counting: readonly CheckLane[]
) => counting.every((count) => lanes.every(({ lane }) => lane !== count.lane));

const countFields = (counted: Counted): Pick<Ran, "counts" | "uncounted"> =>
  Option.match(counted.uncounted, {
    onNone: () => ({ counts: counted.counts }),
    onSome: (uncounted) => ({ counts: counted.counts, uncounted }),
  });

export const runStage = (
  run: AnswerRun,
  tree: TreeSha,
  stage: Stage
): Effect.Effect<StageRun, never, CheckRunner | EvidenceStore | Projects> =>
  Option.match(checkedOf(run, tree), {
    onNone: () => Effect.succeed(StageRun.cases.Moved.make({})),
    onSome: (checked) =>
      Effect.gen(function* () {
        const runner = yield* CheckRunner;
        const evidence = yield* EvidenceStore;
        const lanes = lanesFor(run, stage);

        // The project scans each log for its stored values here, where the values are;
        // never in the sandbox.
        const api = yield* Projects.use((projects) =>
          projects.get(checked.project)
        ).pipe(Effect.orDie);

        const scan = (text: string) => api.scanForValues({ text });

        const remerges = LandingState.guards.Checking(run.state)
          ? run.state.remerges
          : 0;

        const counting = countingLanesOf(run, stage);

        if (
          !Array.isReadonlyArrayNonEmpty(lanes) &&
          !Array.isReadonlyArrayNonEmpty(counting)
        ) {
          return StageRun.cases.Ran.make({ checked, lanes: [] });
        }

        const block = yield* runBlockOf(checked);

        const job = (each: readonly CheckLane[]) =>
          runner
            .run({
              ...(checked.env ?? noRunEnv),
              at: CheckAt.cases.Tree.make({ tree }),
              lanes: each,
              project: checked.project,
              repo: checked.fork,
              run: block,
            })
            .pipe(Effect.flatMap((ran) => countedAskLane(run, ran)));

        // The ratchets are counted in the stage's own job, one container for
        // both, unless a ratchet is named as a lane is: then it runs apart.
        const together =
          !Array.isReadonlyArrayNonEmpty(lanes) || namesApart(lanes, counting);

        const firstRun = yield* job(together ? [...lanes, ...counting] : lanes);

        const counts = Array.isReadonlyArrayNonEmpty(counting)
          ? countFields(
              yield* countRatchets(
                run,
                counting,
                together ? firstRun : yield* job(counting)
              )
            )
          : {};

        if (!Array.isReadonlyArrayNonEmpty(lanes)) {
          return StageRun.cases.Ran.make({
            checked,
            lanes: [],
            ...counts,
          });
        }

        const first = byLane(firstRun);

        const troubled = lanes.filter(({ lane }) =>
          isTrouble(first.results.get(lane)?.result ?? "blocked")
        );

        const fresh = Array.isReadonlyArrayNonEmpty(troubled)
          ? byLane(yield* job(troubled))
          : noRun;

        const laneRuns = yield* Effect.forEach(lanes, (lane) => {
          const standing = standingOf(lane, first, fresh);
          const judged = laneRunOf(checked, standing);

          if (standing.first.result === "passed") {
            return Effect.succeed(judged);
          }

          const text = laneLog(standing.stands, standing.said);

          return Effect.flatMap(scan(text), (found) =>
            Option.match(found, {
              onNone: () =>
                Effect.map(
                  evidence.put({
                    attempt: remerges + 1,
                    lane: lane.lane,
                    project: checked.project,
                    requestId: checked.requestId,
                    text,
                  }),
                  (logRef) => ({
                    ...judged,
                    result: { ...judged.result, logRef },
                  })
                ),
              onSome: (item) =>
                Effect.as(
                  Effect.logWarning(
                    "a lane's log held a stored write-only value; it was not kept"
                  ).pipe(
                    Effect.annotateLogs({
                      item,
                      lane: lane.lane,
                      project: checked.project,
                      requestId: checked.requestId,
                    })
                  ),
                  {
                    ...judged,
                    result: { ...judged.result, logRef: withheld },
                  }
                ),
            })
          );
        });

        return StageRun.cases.Ran.make({
          checked,
          lanes: laneRuns,
          ...counts,
        });
      }).pipe(
        Effect.catchTag("VerifierBlocked", () =>
          Effect.succeed(
            StageRun.cases.Blocked.make({ attempt: checked.attempt })
          )
        )
      ),
  });

export const toCompareOnMain = (ran: Ran): readonly CheckLane[] =>
  ran.lanes
    .filter(
      ({ check, first }) =>
        first !== "passed" && check.lane !== ran.checked.askLane
    )
    .map(({ check }) => check);

export const refusalsOf = (
  ran: Ran,
  onMain: ReadonlyMap<LaneName, LaneOutcome>
): readonly (ChecksFailed | Flake | StaleBase | VerifierBlocked)[] => {
  const { checked } = ran;
  const changed = new Set(checked.changed);

  return Array.getSomes(
    ran.lanes.map(({ failingPaths, first, rerun, result }) =>
      Option.flatMap(Option.fromUndefinedOr(result.logRef), (logRef) =>
        classifyFailure(
          {
            command: result.command,
            failingPaths,
            isDoctor: false,
            lane: result.lane,
            logRef,
            onMain:
              result.lane === checked.askLane
                ? "passed"
                : (onMain.get(result.lane) ?? "blocked"),
            onMerged: first,
            rerun: Option.fromUndefinedOr(rerun),
          },
          changed,
          { base: checked.base, main: checked.main }
        )
      )
    )
  );
};

export const laneOnMain = (
  checked: Checked,
  lane: CheckLane
): Effect.Effect<LaneOutcome, never, CheckRunner> =>
  Effect.flatMap(runBlockOf(checked), (block) =>
    CheckRunner.use((runner) =>
      runner.run({
        ...(checked.env ?? noRunEnv),
        at: CheckAt.cases.Commit.make({ commit: checked.main }),
        lanes: [lane],
        project: checked.project,
        repo: checked.repo,
        run: block,
      })
    )
  ).pipe(
    Effect.map(
      ({ lanes }): LaneOutcome =>
        lanes.find((each) => each.lane === lane.lane)?.result ?? "blocked"
    ),
    Effect.catchTag("VerifierBlocked", () =>
      Effect.succeed<LaneOutcome>("blocked")
    )
  );
