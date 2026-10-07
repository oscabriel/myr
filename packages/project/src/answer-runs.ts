/**
 * The `AnswerRuns` port: how the project service starts carrying an admitted
 * answer to its verdict and onto main. The project only records where each
 * answer stands; a run does the slow part (merge, checks, land) through the
 * project's answer queue, step by step, and reports each step back.
 *
 * Adapters: `/inline` here, which runs the steps in process (tests, W2), and
 * the Answer Workflow in `apps/platform` (W3 304), which runs each step as a
 * durable Workflow step. Both drive the same two methods, `answer` and
 * `advanceAnswer`, with the same steps (`answer-runs/steps.ts`), so they
 * reach the same outcome.
 */
import { CheckLane } from "@repo/checks/check-runner";
import {
  HeldBackResult,
  LaneResult,
  Verdict,
} from "@repo/protocol/domain/answer";
import { Ask } from "@repo/protocol/domain/ask";
import { Choice } from "@repo/protocol/domain/decision";
import { AskKind } from "@repo/protocol/domain/kind";
import { Outcome } from "@repo/protocol/domain/outcome";
import { RunBlock } from "@repo/protocol/domain/run";
import {
  AskId,
  CommitSha,
  DecisionId,
  Handle,
  LandedSha,
  LaneName,
  RepoName,
  RepoPath,
  TreeSha,
} from "@repo/protocol/ids";
import type { RequestId } from "@repo/protocol/ids";
import { Refusal, VerifierBlocked } from "@repo/protocol/refusal";
import { Context, Effect, Option, Schema } from "effect";

import { Change, LandingState, PendingDecision } from "./landing.ts";
import type { LandingCommand, LandingEffect } from "./landing.ts";

const Attempt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * A `LandingCommand` as it crosses a boundary: what a step reports back to
 * the project (W3's Answer Workflow calls `advanceAnswer` over the Project
 * Durable Object's boundary with it).
 */
export const ReportedCommand = Schema.TaggedUnion({
  Blocked: { attempt: Attempt },
  Busy: { attempt: Attempt },
  Checked: {
    decisions: Schema.Array(PendingDecision),
    finish: AskKind.fields.finish,
    refusals: Schema.Array(Refusal),
    tree: TreeSha,
  },
  Decided: { by: Handle, choice: Choice, decision: DecisionId },
  Finished: { by: Handle },
  LandedOk: { sha: LandedSha },
  MainMoved: { from: LandedSha, main: LandedSha },
  MergeConflict: { conflicts: Schema.Array(RepoPath), main: LandedSha },
  Merged: { changes: Schema.Array(Change), main: LandedSha, tree: TreeSha },
  Start: { main: LandedSha },
  Wait: { parent: AskId },
});

/**
 * A port call a run makes next, as `advanceAnswer` returns it: a merge, the
 * checks, a land, or a `Retry` to wait for (the project's alarm starts the
 * run again then). The project settles every other `LandingEffect` itself.
 */
export const NextStep = Schema.TaggedUnion({
  Land: { main: LandedSha, tree: TreeSha },
  Merge: { base: CommitSha, fork: RepoName, head: CommitSha, main: LandedSha },
  Retry: { at: Schema.DateTimeUtcFromString },
  RunChecks: { tree: TreeSha },
});

/** What `advanceAnswer` returns, as it crosses a boundary: `Advanced`. */
export const Steps = Schema.Struct({
  effects: Schema.Array(NextStep),
  outcome: Outcome,
});

/**
 * One answer request as a run needs it: where it stands, whether it holds
 * the project's one landing slot, and the policy's facts its steps use. It
 * crosses the Project Durable Object's boundary, so it is a schema.
 */
export const AnswerRun = Schema.Struct({
  /** Whether the request holds the landing slot: a `Landing` lands only then. */
  admitted: Schema.Boolean,
  /** The ask it answers; absent for a decider's own landing. */
  ask: Schema.optionalKey(Ask),
  /** The lane the ask's own check reports as, which is red on main by design. */
  askLane: Schema.optionalKey(LaneName),
  /** Whether a decider must finish it before it lands: the ask kind's `finish`. */
  finish: AskKind.fields.finish,
  /** What the checks run on the merged tree: the ask's check first, then every project lane. */
  lanes: Schema.Array(CheckLane),
  /** The landing commit's whole message, trailers included, once the answer is checked. */
  message: Schema.optionalKey(Schema.String),
  /** The canonical repo the answer lands on. */
  repo: RepoName,
  /**
   * The project's run block, which every check job carries: absent while
   * the project has no policy (the gate is broken, and nothing is checked).
   */
  run: Schema.optionalKey(RunBlock),
  state: LandingState,
  /** The verdict on the merged tree, once the checks judged it. */
  verdict: Schema.optionalKey(Verdict),
});

export type AnswerRun = typeof AnswerRun.Type;

/**
 * The run block every check job of an answer's run carries: `VerifierBlocked`
 * while the project has none, since the Checker never guesses a project's
 * setup (live on dev-oscabriel, 311: a job without one was blocked).
 */
export const runBlockOf = (from: {
  readonly run?: RunBlock;
}): Effect.Effect<RunBlock, VerifierBlocked> =>
  Effect.fromOption(Option.fromUndefinedOr(from.run)).pipe(
    Effect.mapError(() => new VerifierBlocked({}))
  );

/**
 * What a step saw beside the command it reports: the lanes and held-back
 * areas a check run judged (the verdict is made from them), and the
 * bookkeeping a land left unwritten (the project retries it).
 */
export const AnswerReport = Schema.Struct({
  heldBack: Schema.optionalKey(Schema.Array(HeldBackResult)),
  lanes: Schema.optionalKey(Schema.Array(LaneResult)),
  pending: Schema.optionalKey(
    Schema.Array(Schema.Literals(["mirror", "notes"]))
  ),
});

export type AnswerReport = typeof AnswerReport.Type;

/** What one reported step changed: where the answer stands now, and the port calls to run next. */
export interface Advanced {
  readonly effects: readonly LandingEffect[];
  readonly outcome: Outcome;
}

/**
 * A project's answer queue, as a run sees it: read one answer's run, and
 * report what a step came to. `advanceAnswer` returns only the port calls
 * the run makes next (`Merge`, `RunChecks`, `Land`), and a `Retry` when it
 * should stop and wait for the project's alarm; the project settles
 * everything else itself.
 */
export interface AnswerQueue {
  readonly advanceAnswer: (
    requestId: RequestId,
    command: LandingCommand,
    report?: AnswerReport
  ) => Effect.Effect<Advanced>;
  readonly answer: (
    requestId: RequestId
  ) => Effect.Effect<Option.Option<AnswerRun>>;
}

/**
 * Starts the run of one answer request. Idempotent by id: starting a run
 * already under way, or already over, changes nothing. `queue` is the
 * project's own answer queue, which an in-process adapter drives directly;
 * the Workflow adapter reaches the same queue through the project's Durable
 * Object and ignores it.
 */
export class AnswerRuns extends Context.Service<
  AnswerRuns,
  {
    readonly start: (
      requestId: RequestId,
      queue: AnswerQueue
    ) => Effect.Effect<void>;
  }
>()("project/AnswerRuns") {}
