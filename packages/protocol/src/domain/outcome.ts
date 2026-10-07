import { Schema } from "effect";

import { AskId, DecisionId, Handle, LandedSha } from "../ids.ts";
import { Refusal } from "../refusal.ts";

/** A stage of the gate, in the order of its cost. */
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

/**
 * Where an answer stands: still being checked, landed, waiting (on its
 * parent ask, a finish or a decision), or refused. Waiting is not a refusal.
 */
export const Outcome = Schema.TaggedUnion({
  /** Waits on a decision, such as a posture change. */
  AwaitingDecision: { decision: DecisionId },
  /** Passed, and waits for a decider's finish. */
  AwaitingFinish: { decider: Schema.optionalKey(Handle) },
  /** The gate is at this stage. */
  Checking: { stage: StageName },
  Landed: { sha: LandedSha },
  /** Every refusal from the cheapest failing stage. */
  Refused: { refusals: Schema.NonEmptyArray(Refusal) },
  /** Passed, and waits for its parent ask to land. */
  WaitingOnParent: { ask: AskId },
});

export type Outcome = typeof Outcome.Type;
