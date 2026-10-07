import { Schema } from "effect";

import {
  AreaName,
  AskId,
  CheckVersion,
  CommitSha,
  LaneName,
  PatchId,
  ProjectName,
  RequestId,
  SuiteRoot,
  TreeSha,
} from "../ids.ts";
import { Outcome, StageName } from "./outcome.ts";

/** How one lane's run ended. A load error is not a failure by an assertion. */
export const LaneOutcome = Schema.Literals([
  "passed",
  "failed",
  "loadError",
  "flaked",
  "blocked",
]);

export type LaneOutcome = typeof LaneOutcome.Type;

/** One lane of the project's checks, run on an answer's merged tree. */
export const LaneResult = Schema.Struct({
  command: Schema.NonEmptyString,
  durationMs: Schema.Int,
  lane: LaneName,
  /** Where the platform keeps the log; an answerer reads it through the platform, never raw. */
  logRef: Schema.optionalKey(Schema.NonEmptyString),
  result: LaneOutcome,
});

export type LaneResult = typeof LaneResult.Type;

/**
 * Held-back checks in one area: how many passed, of how many, under which
 * commitment. Nothing else about them is disclosed.
 */
export const HeldBackResult = Schema.Struct({
  area: AreaName,
  passed: Schema.Int,
  suite: SuiteRoot,
  total: Schema.Int,
});

export type HeldBackResult = typeof HeldBackResult.Type;

/**
 * The record of one check run on an answer: base, head, the merged tree, the
 * patch id, the check version and the platform as verifier, with each lane
 * and the outcome. It is kept with the landing.
 */
export const Verdict = Schema.Struct({
  ask: AskId,
  at: Schema.DateTimeUtcFromString,
  base: CommitSha,
  checkVersion: CheckVersion,
  head: CommitSha,
  heldBack: Schema.Array(HeldBackResult),
  lanes: Schema.Array(LaneResult),
  outcome: Outcome,
  patchId: PatchId,
  project: ProjectName,
  /** The furthest stage the answer reached. */
  stage: StageName,
  /** The merged tree the checks ran on. */
  tree: TreeSha,
  verifier: Schema.Literal("platform"),
});

export type Verdict = typeof Verdict.Type;

/**
 * What an answerer gets back on offering an answer: the request, and where
 * the answer stands, usually still being checked.
 */
export const AnswerReceipt = Schema.Struct({
  ask: AskId,
  base: CommitSha,
  head: CommitSha,
  outcome: Outcome,
  project: ProjectName,
  requestId: RequestId,
});

export type AnswerReceipt = typeof AnswerReceipt.Type;

/** One of a person's answers, as their status shows it. */
export const AnswerView = Schema.Struct({
  ask: AskId,
  at: Schema.DateTimeUtcFromString,
  head: CommitSha,
  outcome: Outcome,
  requestId: RequestId,
});

export type AnswerView = typeof AnswerView.Type;
