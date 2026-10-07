/**
 * The verdict: the record of one check run on an answer, which the platform
 * keeps with the landing and writes as a note on the answer's head. It takes
 * `now` from its caller and reads no clock (principle 8).
 */
import type {
  HeldBackResult,
  LaneResult,
  Verdict,
} from "@repo/protocol/domain/answer";
import type { Outcome, StageName } from "@repo/protocol/domain/outcome";
import type { CheckVersion, PatchId, TreeSha } from "@repo/protocol/ids";
import { NoAsk } from "@repo/protocol/refusal";
import { Option, Result } from "effect";
import type { DateTime } from "effect";

import type { PushFacts } from "./facts.ts";

/** What one check run found, and where it got to. */
export interface VerdictInput {
  readonly facts: PushFacts;
  /** The merged tree the checks ran on. */
  readonly tree: TreeSha;
  readonly patchId: PatchId;
  readonly checkVersion: CheckVersion;
  /** The furthest stage the answer reached. */
  readonly stage: StageName;
  readonly lanes: readonly LaneResult[];
  readonly heldBack: readonly HeldBackResult[];
  readonly outcome: Outcome;
  readonly now: DateTime.Utc;
}

/**
 * The verdict on the answer `facts` describe. A verdict is about an answer to
 * an ask, so a push that answers none (a decider's own landing) has none:
 * `NoAsk`.
 */
export const verdictOf = (input: VerdictInput): Result.Result<Verdict, NoAsk> =>
  Option.match(input.facts.ask, {
    onNone: () => Result.fail(new NoAsk({})),
    onSome: (ask) =>
      Result.succeed({
        ask: ask.id,
        at: input.now,
        base: input.facts.base,
        checkVersion: input.checkVersion,
        head: input.facts.head,
        heldBack: input.heldBack,
        lanes: input.lanes,
        outcome: input.outcome,
        patchId: input.patchId,
        project: ask.project,
        stage: input.stage,
        tree: input.tree,
        verifier: "platform" as const,
      }),
  });
