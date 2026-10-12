import { Schema, Struct } from "effect";

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

export const LaneOutcome = Schema.Literals([
  "passed",
  "failed",
  "loadError",
  "flaked",
  "blocked",
]);

export type LaneOutcome = typeof LaneOutcome.Type;

export const LaneResult = Schema.Struct({
  command: Schema.NonEmptyString,
  durationMs: Schema.Int,
  lane: LaneName,
  logRef: Schema.optionalKey(Schema.NonEmptyString),
  result: LaneOutcome,
});

export type LaneResult = typeof LaneResult.Type;

/** Held-back checks in one area. Nothing beyond these counts is disclosed. */
export const HeldBackResult = Schema.Struct({
  area: AreaName,
  passed: Schema.Int,
  suite: SuiteRoot,
  total: Schema.Int,
});

export type HeldBackResult = typeof HeldBackResult.Type;

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
  stage: StageName,
  tree: TreeSha,
  verifier: Schema.Literal("platform"),
});

export type Verdict = typeof Verdict.Type;

export const AnswerReceipt = Schema.Struct({
  ask: AskId,
  base: CommitSha,
  head: CommitSha,
  outcome: Outcome,
  project: ProjectName,
  requestId: RequestId,
});

export type AnswerReceipt = typeof AnswerReceipt.Type;

export const LandReceipt = AnswerReceipt.mapFields(Struct.omit(["ask"]));

export type LandReceipt = typeof LandReceipt.Type;

export const AnswerView = Schema.Struct({
  ask: AskId,
  at: Schema.DateTimeUtcFromString,
  head: CommitSha,
  outcome: Outcome,
  requestId: RequestId,
});

export type AnswerView = typeof AnswerView.Type;
