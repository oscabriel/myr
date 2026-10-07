/**
 * The answer's lanes on its merged tree (spec §5 step 7 (b), (c)): the
 * cheap stage (the static lanes) and then the checks (the ask's own check
 * and every other project lane), always on the exact tree the merge made.
 * A lane whose checker never got going gets one fresh run; every lane that
 * did not pass keeps its log through `EvidenceStore`, and only the name it
 * is kept under travels on. The gate classifies each failure against the
 * same lane on main (`gate.classifyFailure`).
 *
 * The merged tree is checked in the answer's fork, where `Lander.merge`
 * keeps it (under `${Brand.refsPrefix}merge/<tree>`), so a merge needs no
 * write token on the canonical repo; main is checked in the canonical repo.
 */
import { CheckAt, CheckLane, CheckRunner } from "@repo/checks/check-runner";
import type { CheckRun, LaneEvidence } from "@repo/checks/check-runner";
import { EvidenceStore } from "@repo/checks/evidence-store";
import { classifyFailure } from "@repo/gate/classify";
import type { AnswerRun } from "@repo/project/answer-runs";
import { LandingState } from "@repo/project/landing";
import {
  HeldBackResult,
  LaneOutcome,
  LaneResult,
} from "@repo/protocol/domain/answer";
import { AskKind } from "@repo/protocol/domain/kind";
import {
  CommitSha,
  LandedSha,
  LaneName,
  ProjectName,
  RepoName,
  RepoPath,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import type {
  ChecksFailed,
  Flake,
  StaleBase,
  VerifierBlocked,
} from "@repo/protocol/refusal";
import { Array, Effect, Option, Order, Schema } from "effect";

/**
 * The lanes the cheap stage runs before the costlier checks: the static
 * ones, under the names the run block finder gives them (`checks/finder`).
 * Ratchet counts join them in W4 (417).
 */
export const cheapLanes = ["format", "lint", "types"] as const;

/** Which of the answer's lanes a stage runs. */
export type Stage = "cheap" | "checks";

const isCheap = (lane: LaneName) =>
  cheapLanes.some((name): boolean => name === lane);

/** The lanes of `run` that `stage` runs; the ask's own check is never cheap. */
export const lanesFor = (run: AnswerRun, stage: Stage): readonly CheckLane[] =>
  run.lanes.filter(
    ({ lane }) =>
      (stage === "cheap") === (isCheap(lane) && lane !== run.askLane)
  );

/** What the lanes are judged against: the answer's request, its merge and its main. */
export const Checked = Schema.Struct({
  /** The lane the ask's own check reports as: red on main by design. */
  askLane: Schema.optionalKey(LaneName),
  attempt: Schema.Int,
  base: CommitSha,
  /** Every path the answer changed against its base. */
  changed: Schema.Array(RepoPath),
  finish: AskKind.fields.finish,
  /**
   * The answer's fork, which holds the merged tree: the Lander keeps it there
   * under `${Brand.refsPrefix}merge/<tree>` for the Checker to fetch.
   */
  fork: RepoName,
  main: LandedSha,
  project: ProjectName,
  /** The canonical repo, which holds main. */
  repo: RepoName,
  requestId: RequestId,
  tree: TreeSha,
});

export type Checked = typeof Checked.Type;

/** One lane on the merged tree, as the gate classifies it. */
export const LaneRun = Schema.Struct({
  /** The lane as the project runs it: what runs again on main. */
  check: CheckLane,
  /** The repo files outside tests its failure points at, when its log names any. */
  failingPaths: Schema.Array(RepoPath),
  /** How its first run on the merged tree ended. */
  first: LaneOutcome,
  /** How its fresh run ended, when the first never got going. */
  rerun: Schema.optionalKey(LaneOutcome),
  /** The result that stands, with where its log is kept when it did not pass at first. */
  result: LaneResult,
});

export type LaneRun = typeof LaneRun.Type;

/** What one stage's run on the merged tree came to. */
export const StageRun = Schema.TaggedUnion({
  /** The checker could not run at all: the project tries again later. */
  Blocked: { attempt: Schema.Int },
  /** The answer no longer waits on these checks: another run moved it on. */
  Moved: {},
  Ran: {
    checked: Checked,
    heldBack: Schema.Array(HeldBackResult),
    lanes: Schema.Array(LaneRun),
  },
});

export type StageRun = typeof StageRun.Type;

type Ran = Extract<StageRun, { readonly _tag: "Ran" }>;

/**
 * A path with a line, as a stack frame or a compiler prints one:
 * `src/lex.ts:3:7`. Its extension starts with a letter, so an address and
 * its port (`127.0.0.1:8080`) is no file.
 */
const LOCATION =
  /(?<![\w./@+-])(?<path>(?:[\w@+-][\w.@+-]*\/)*[\w@+-][\w.@+-]*\.[A-Za-z][A-Za-z0-9]*):\d+/gu;

/** A file whose failure says nothing about where the code broke: a test itself. */
const TEST_FILE =
  /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[A-Za-z0-9]+$/u;

/**
 * The repo files a lane's failure points at: every relative `path:line` its
 * output names, tests left out (a test failing in its own file says
 * nothing about which code broke). Absolute paths are not the repo's.
 */
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

/**
 * A lane's log, as the platform keeps it. The Checker's `CheckRun` carries
 * no raw output yet, so the log is what the run said of the lane: its end,
 * its command, and its failure's signature.
 */
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

const isTrouble = (result: LaneOutcome) =>
  result === "flaked" || result === "blocked";

/** Each lane's result and evidence in a run, by lane. */
interface ByLane {
  readonly evidence: ReadonlyMap<LaneName, LaneEvidence>;
  readonly results: ReadonlyMap<LaneName, LaneResult>;
}

const byLane = (run: CheckRun): ByLane => ({
  evidence: new Map(run.evidence.map((each) => [each.lane, each])),
  results: new Map(run.lanes.map((each) => [each.lane, each])),
});

const noRun: ByLane = { evidence: new Map(), results: new Map() };

/** One lane as a stage's runs left it. */
interface Standing {
  readonly check: CheckLane;
  /** Its first run on the merged tree; `blocked` when that run left it out. */
  readonly first: LaneResult;
  /** Its fresh run, when it had one. */
  readonly again: Option.Option<LaneResult>;
  /** The result that stands: the fresh run's, else the first. */
  readonly stands: LaneResult;
  /** What the run that stands said of it, when it did not pass. */
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

/** A lane as the gate classifies it, before its log is kept. */
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

/** What the answer's state says the lanes are judged against, when it waits on checks of `tree`. */
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

  return Option.some(
    run.askLane === undefined ? checked : { ...checked, askLane: run.askLane }
  );
};

/**
 * One stage's lanes on the merged tree `tree`: run, a troubled lane run
 * once more, and each lane that did not pass at first logged. The log's
 * name counts the answer's merges (`#1` on its first main), so a replayed
 * step keeps its log under the same name and a re-merge gets a new one.
 */
export const runStage = (
  run: AnswerRun,
  tree: TreeSha,
  stage: Stage
): Effect.Effect<StageRun, never, CheckRunner | EvidenceStore> =>
  Option.match(checkedOf(run, tree), {
    onNone: () => Effect.succeed(StageRun.cases.Moved.make({})),
    onSome: (checked) =>
      Effect.gen(function* () {
        const runner = yield* CheckRunner;
        const evidence = yield* EvidenceStore;
        const lanes = lanesFor(run, stage);

        const remerges = LandingState.guards.Checking(run.state)
          ? run.state.remerges
          : 0;

        const job = (each: readonly CheckLane[]) =>
          runner.run({
            at: CheckAt.cases.Tree.make({ tree }),
            lanes: each,
            placeholders: [],
            project: checked.project,
            proxies: [],
            repo: checked.fork,
          });

        if (!Array.isReadonlyArrayNonEmpty(lanes)) {
          return StageRun.cases.Ran.make({ checked, heldBack: [], lanes: [] });
        }

        const firstRun = yield* job(lanes);
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

          return Effect.map(
            evidence.put({
              attempt: remerges + 1,
              lane: lane.lane,
              project: checked.project,
              requestId: checked.requestId,
              text: laneLog(standing.stands, standing.said),
            }),
            (logRef) => ({ ...judged, result: { ...judged.result, logRef } })
          );
        });

        return StageRun.cases.Ran.make({
          checked,
          heldBack: firstRun.heldBack,
          lanes: laneRuns,
        });
      }).pipe(
        Effect.catchTag("VerifierBlocked", () =>
          Effect.succeed(
            StageRun.cases.Blocked.make({ attempt: checked.attempt })
          )
        )
      ),
  });

/** The lanes of a stage's run whose failure the gate classifies against main. */
export const toCompareOnMain = (ran: Ran): readonly CheckLane[] =>
  ran.lanes
    .filter(
      ({ check, first }) =>
        first !== "passed" && check.lane !== ran.checked.askLane
    )
    .map(({ check }) => check);

/**
 * Each failing lane, classified by the gate: against the same lane on main
 * (`onMain`; the ask's own check counts as green there, since it is red on
 * main by design), the fresh run, and the paths the answer changed.
 */
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

/** A lane's end on main: what the gate compares a failure on the merged tree with. */
export const laneOnMain = (
  checked: Checked,
  lane: CheckLane
): Effect.Effect<LaneOutcome, never, CheckRunner> =>
  CheckRunner.use((runner) =>
    runner.run({
      at: CheckAt.cases.Commit.make({ commit: checked.main }),
      lanes: [lane],
      placeholders: [],
      project: checked.project,
      proxies: [],
      repo: checked.repo,
    })
  ).pipe(
    Effect.map(
      ({ lanes }): LaneOutcome =>
        lanes.find((each) => each.lane === lane.lane)?.result ?? "blocked"
    ),
    Effect.catchTag("VerifierBlocked", () =>
      Effect.succeed<LaneOutcome>("blocked")
    )
  );
