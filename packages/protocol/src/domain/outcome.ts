import { Schema } from "effect";

import { AskId, DecisionId, Handle, LandedSha } from "../ids.ts";
import { Refusal } from "../refusal.ts";

export const StageName = Schema.Literals([
  "parse",
  "shape",
  "merge",
  "cheap",
  "checks",
  "heldBack",
  "human",
]);

export type StageName = typeof StageName.Type;

export const Outcome = Schema.TaggedUnion({
  AwaitingDecision: { decision: DecisionId },
  AwaitingFinish: { decider: Schema.optionalKey(Handle) },
  Checking: { stage: StageName },
  Landed: { sha: LandedSha },
  Refused: { refusals: Schema.NonEmptyArray(Refusal) },
  WaitingOnParent: { ask: AskId },
});

export type Outcome = typeof Outcome.Type;
