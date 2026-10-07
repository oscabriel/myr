/**
 * Vouches and denouncements (GLOSSARY "Vouch", "Denouncement"), and the
 * trust rules they feed: who may claim an ask, and who may propose one.
 * Every answer is yes or no; nothing here ranks or scores anyone.
 *
 * A person's standing comes from the vouch file at the landed SHA (parsed
 * into `Policy.vouches`), plus the vouch decisions decided since, which win
 * because they are newer. The project's deciders are its members, the people
 * who vouch, so they stand vouched without a line of their own: otherwise the
 * person who made a project could not fork it or claim in it (spec D11, D20).
 *
 * Pure: the project service passes the decisions, the person's record and
 * how many of their landings the project holds.
 */
import type { Ask } from "@repo/protocol/domain/ask";
import type { AskKind, ClaimRule } from "@repo/protocol/domain/kind";
import type { Policy } from "@repo/protocol/domain/policy";
import type { Handle } from "@repo/protocol/ids";
import { Denounced, NotVouched } from "@repo/protocol/refusal";
import { Array as Arr, DateTime, Match, Option, Order, Result } from "effect";

import { meets, sameHandle } from "./record.ts";
import type { RecordEntry } from "./record.ts";

/** Where a person stands with a project: vouched for, denounced, or neither. */
export type Standing = "vouched" | "denounced" | "unknown";

/** A vouch decision decided since the landed SHA, not yet in the vouch file there. */
export interface DecidedVouch {
  readonly at: DateTime.Utc;
  readonly handle: Handle;
  readonly verdict: "vouch" | "denounce";
}

/** What `mayClaim` weighs. */
export interface ClaimQuestion {
  readonly ask: Ask;
  /** The ask's kind, whose `claimers` rule says who may claim it. */
  readonly kind: AskKind;
  /** How many landings the person is accountable for in this project, held or not. */
  readonly landingsInProject: number;
  readonly policy: Policy;
  /** The person's record (`recordOf`), for a kind's record rule; entries in other projects never count. */
  readonly record: readonly RecordEntry[];
  readonly standing: Standing;
}

/** Why a person may not claim or propose. */
export type TrustRefusal = Denounced | NotVouched;

/** Yes, or the refusal that says why not. */
export type TrustAnswer = Result.Result<void, TrustRefusal>;

const allowed: TrustAnswer = Result.void;

/** Oldest first; at one instant, a denouncement after a vouch, so it wins. */
const byWhen = Order.combine(
  Order.mapInput(DateTime.Order, ({ at }: DecidedVouch) => at),
  Order.mapInput(
    Order.Boolean,
    ({ verdict }: DecidedVouch) => verdict === "denounce"
  )
);

/** The vouch file's word on a person: a denouncement beats a vouch on another line. */
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

/** Whether the person decides for any paths in the project. */
const isDecider = (policy: Policy, handle: Handle) =>
  policy.deciders.some(({ handles }) =>
    handles.some((each) => sameHandle(each, handle))
  );

/**
 * A person's standing: the latest vouch decision about them, if any;
 * else the vouch file (`-handle` denounces, and wins over a vouch); else
 * `vouched` for a decider; else `unknown`. Handles match without case.
 */
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

/**
 * Whether a newcomer claims an ask held for newcomers that names their
 * mentor: the mentor stands in for the vouch, as the `newcomer` rule's does.
 */
const mentored = ({ ask, landingsInProject }: ClaimQuestion) =>
  ask.reserve === "newcomers" &&
  ask.mentor !== undefined &&
  landingsInProject === 0;

/**
 * Whether a kind's `claimers` rule admits the person: `anyone`; `vouched`,
 * which the `bansOnly` mode lifts and a newcomers ask's mentor stands in
 * for; a record of `atLeast` held landings in an area of the ask's project,
 * which no vouch or mentor stands in for; or a newcomer, with no landing in
 * the project, whose mentor the rule names and who needs no vouch for it.
 */
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

/**
 * May this person claim this ask? A denounced person never may, in any
 * mode. An ask reserved for `newcomers` takes only people with no landing in
 * the project, and otherwise follows its kind: the reserve narrows who the
 * kind admits, and widens it only by its mentor, who stands in for a vouch
 * (never for a record). An ask reserved for `people` refuses nobody: it
 * tells agents' harnesses to leave it to a person, and the platform can't
 * tell who typed a claim, so it is a hint only. Then the kind's `claimers`
 * rule decides. Every refusal but a denouncement is `NotVouched`: the person
 * is not admitted to this ask.
 */
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

/**
 * May this person propose an ask (or flag one)? A vouch gates code, not
 * voice: anyone not denounced may, except under the `all` mode, where a
 * proposal needs a vouch too.
 */
export const mayPropose = (policy: Policy, who: Standing): TrustAnswer => {
  if (who === "denounced") {
    return Result.fail(new Denounced({}));
  }

  return policy.vouch.mode === "all" && who !== "vouched"
    ? Result.fail(new NotVouched({}))
    : allowed;
};
