import type { Ask } from "@repo/protocol/domain/ask";
import type { AskKind, ClaimRule } from "@repo/protocol/domain/kind";
import type { Policy } from "@repo/protocol/domain/policy";
import { sameHandle } from "@repo/protocol/ids";
import type { Handle } from "@repo/protocol/ids";
import { Denounced, NotVouched } from "@repo/protocol/refusal";
import { Array as Arr, DateTime, Match, Option, Order, Result } from "effect";

import { meets } from "./record.ts";
import type { RecordEntry } from "./record.ts";

export type Standing = "vouched" | "denounced" | "unknown";

export interface DecidedVouch {
  readonly at: DateTime.Utc;
  readonly handle: Handle;
  readonly verdict: "vouch" | "denounce";
}

export interface ClaimQuestion {
  readonly ask: Ask;
  readonly kind: AskKind;
  readonly landingsInProject: number;
  readonly policy: Policy;
  readonly record: readonly RecordEntry[];
  readonly standing: Standing;
}

export type TrustRefusal = Denounced | NotVouched;

export type TrustAnswer = Result.Result<void, TrustRefusal>;

const allowed: TrustAnswer = Result.void;

// Oldest first; at one instant, a denouncement after a vouch, so it wins.
const byWhen = Order.combine(
  Order.mapInput(DateTime.Order, ({ at }: DecidedVouch) => at),
  Order.mapInput(
    Order.Boolean,
    ({ verdict }: DecidedVouch) => verdict === "denounce"
  )
);

const fileSays = (policy: Policy, handle: Handle): Option.Option<Standing> => {
  const lines = policy.vouches.filter((line) =>
    sameHandle(line.handle, handle)
  );

  if (lines.some(({ denounced }) => denounced)) {
    return Option.some("denounced");
  }

  return Arr.isReadonlyArrayNonEmpty(lines)
    ? Option.some("vouched")
    : Option.none();
};

const isDecider = (policy: Policy, handle: Handle) =>
  policy.deciders.some(({ handles }) =>
    handles.some((each) => sameHandle(each, handle))
  );

export const standing = (
  policy: Policy,
  decided: readonly DecidedVouch[],
  handle: Handle
): Standing => {
  const latest = Arr.last(
    Arr.sort(
      decided.filter((each) => sameHandle(each.handle, handle)),
      byWhen
    )
  );

  return Option.match(latest, {
    onNone: () =>
      Option.getOrElse(fileSays(policy, handle), () =>
        isDecider(policy, handle) ? "vouched" : "unknown"
      ),
    onSome: ({ verdict }) =>
      Match.value(verdict).pipe(
        Match.when("denounce", (): Standing => "denounced"),
        Match.when("vouch", (): Standing => "vouched"),
        Match.exhaustive
      ),
  });
};

/** The caps are for the public: someone the project vouches for, or a decider, works without them. */
export const capped = (who: Standing) => who !== "vouched";

/** What a person may hold of a capped thing at once; no limit for a vouched one. */
export const capFor = (who: Standing, cap: number) =>
  capped(who) ? cap : Number.MAX_SAFE_INTEGER;

const mentored = ({ ask, landingsInProject }: ClaimQuestion) =>
  ask.reserve === "newcomers" &&
  ask.mentor !== undefined &&
  landingsInProject === 0;

const admits = (rule: ClaimRule, question: ClaimQuestion): boolean =>
  Match.value(rule).pipe(
    Match.when("anyone", () => true),
    Match.when(
      "vouched",
      () =>
        question.standing === "vouched" ||
        question.policy.vouch.mode === "bansOnly" ||
        mentored(question)
    ),
    Match.when({ record: Match.defined }, ({ record }) =>
      meets(
        question.record.filter(
          ({ project }) => project === question.ask.project
        ),
        record
      )
    ),
    Match.when(
      { newcomer: Match.defined },
      () => question.landingsInProject === 0
    ),
    Match.exhaustive
  );

// An ask reserved for `people` refuses nobody: the platform can't tell who typed a
// claim, so the reserve is a hint to agents' harnesses only.
export const mayClaim = (question: ClaimQuestion): TrustAnswer => {
  if (question.standing === "denounced") {
    return Result.fail(new Denounced({}));
  }

  if (question.ask.reserve === "newcomers" && question.landingsInProject > 0) {
    return Result.fail(new NotVouched({}));
  }

  return admits(question.kind.claimers, question)
    ? allowed
    : Result.fail(new NotVouched({}));
};

export const mayPropose = (policy: Policy, who: Standing): TrustAnswer => {
  if (who === "denounced") {
    return Result.fail(new Denounced({}));
  }

  return policy.vouch.mode === "all" && who !== "vouched"
    ? Result.fail(new NotVouched({}))
    : allowed;
};
