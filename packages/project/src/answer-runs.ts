import { CheckLane } from "@repo/checks/check-runner";
import {
  HeldBackResult,
  LaneResult,
  Verdict,
} from "@repo/protocol/domain/answer";
import { Ask } from "@repo/protocol/domain/ask";
import { RatchetSpec } from "@repo/protocol/domain/check";
import { Choice } from "@repo/protocol/domain/decision";
import { AskKind } from "@repo/protocol/domain/kind";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import { RunBlock } from "@repo/protocol/domain/run";
import { Territory } from "@repo/protocol/domain/territory";
import {
  AskId,
  CommitSha,
  DecisionId,
  Handle,
  LandedSha,
  LaneName,
  RatchetName,
  RepoName,
  RepoPath,
  TreeSha,
} from "@repo/protocol/ids";
import type { RequestId } from "@repo/protocol/ids";
import { MovedBy, Refusal, VerifierBlocked } from "@repo/protocol/refusal";
import { Context, Effect, Option, Schema } from "effect";

import { UnlandedRunEnv } from "./env-port.ts";
import { Change, LandingState, PendingDecision } from "./landing.ts";
import type { LandingCommand, LandingEffect } from "./landing.ts";

const Attempt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

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
  MergeConflict: {
    conflicts: Schema.Array(RepoPath),
    main: LandedSha,
    // Absent from steps recorded before a merge named who moved a path.
    movedBy: Schema.optionalKey(Schema.NonEmptyArray(MovedBy)),
  },
  Merged: { changes: Schema.Array(Change), main: LandedSha, tree: TreeSha },
  Start: { main: LandedSha },
  Wait: { parent: AskId },
});

export const NextStep = Schema.TaggedUnion({
  Land: { main: LandedSha, tree: TreeSha },
  Merge: { base: CommitSha, fork: RepoName, head: CommitSha, main: LandedSha },
  Retry: { at: Schema.DateTimeUtcFromString },
  RunChecks: { tree: TreeSha },
});

export const Steps = Schema.Struct({
  effects: Schema.Array(NextStep),
  outcome: Outcome,
});

export const MeasuredCount = Schema.Struct({
  count: Attempt,
  ratchet: RatchetName,
  territory: Schema.NonEmptyString,
});

export type MeasuredCount = typeof MeasuredCount.Type;

export const AnswerRun = Schema.Struct({
  admitted: Schema.Boolean,
  ask: Schema.optionalKey(Ask),
  /** Red on main by design. */
  askLane: Schema.optionalKey(LaneName),
  counts: Schema.optionalKey(
    Schema.Struct({
      modules: Schema.Array(Territory),
      ratchets: Schema.Array(RatchetSpec),
    })
  ),
  /** Placeholders and proxies, never a value. */
  env: Schema.optionalKey(UnlandedRunEnv),
  finish: AskKind.fields.finish,
  lanes: Schema.Array(CheckLane),
  message: Schema.optionalKey(Schema.String),
  repo: RepoName,
  run: Schema.optionalKey(RunBlock),
  sealed: Schema.optionalKey(Schema.Boolean),
  state: LandingState,
  verdict: Schema.optionalKey(Verdict),
});

export type AnswerRun = typeof AnswerRun.Type;

/** `VerifierBlocked` without a run block: the Checker never guesses a project's setup. */
export const runBlockOf = (from: {
  readonly run?: RunBlock;
}): Effect.Effect<RunBlock, VerifierBlocked> =>
  Effect.fromOption(Option.fromUndefinedOr(from.run)).pipe(
    Effect.mapError(() => new VerifierBlocked({}))
  );

export const AnswerReport = Schema.Struct({
  heldBack: Schema.optionalKey(Schema.Array(HeldBackResult)),
  lanes: Schema.optionalKey(Schema.Array(LaneResult)),
  pending: Schema.optionalKey(
    Schema.Array(Schema.Literals(["mirror", "notes"]))
  ),
  ratchets: Schema.optionalKey(Schema.Array(MeasuredCount)),
});

export type AnswerReport = typeof AnswerReport.Type;

export type RunnableEffect = Extract<
  LandingEffect,
  { readonly _tag: NextStep["_tag"] }
>;

type NextStep = typeof NextStep.Type;

export interface Advanced {
  readonly effects: readonly RunnableEffect[];
  readonly outcome: Outcome;
}

export interface AnswerQueue {
  readonly advanceAnswer: (
    requestId: RequestId,
    command: LandingCommand,
    report?: AnswerReport
  ) => Effect.Effect<Advanced>;
  readonly answer: (
    requestId: RequestId
  ) => Effect.Effect<Option.Option<AnswerRun>>;
  /** A commit the platform did not land (imported history) has none. */
  readonly landings: (
    shas: readonly CommitSha[]
  ) => Effect.Effect<readonly LandingView[]>;
}

/** Idempotent by id. The Workflow adapter ignores `queue` and reaches it through the Durable Object. */
export class AnswerRuns extends Context.Service<
  AnswerRuns,
  {
    readonly start: (
      requestId: RequestId,
      queue: AnswerQueue
    ) => Effect.Effect<void>;
  }
>()("project/AnswerRuns") {}
