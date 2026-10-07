/**
 * Decisions: everything in a project that needs a person, each with its
 * evidence, its deciders, an expiry and a safe default that is taken when
 * nobody decides in time. Pure, like the lifecycles: each move takes `now`
 * and returns the next state and its effects as data.
 */
import { matchGlob } from "@repo/gate/glob";
import type { Evidence } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision } from "@repo/protocol/domain/decision";
import type { Policy } from "@repo/protocol/domain/policy";
import { sameHandle } from "@repo/protocol/ids";
import type {
  DecisionId,
  Handle,
  ProjectName,
  RepoPath,
} from "@repo/protocol/ids";
import {
  DecisionClosed,
  NotDecider,
  UnknownDecision,
} from "@repo/protocol/refusal";
import { Array as Arr, DateTime, Option, Result } from "effect";

import { ProjectEventInput } from "../events.ts";
import { AttentionEffect, platformHandle } from "./effects.ts";

/** How a subject's deciders say yes, and no. */
interface Words {
  readonly no: Choice;
  readonly yes: Choice;
}

const acceptOrDecline: Words = { no: "decline", yes: "accept" };

/**
 * A stray push is adopted or reverted; everything else is accepted or
 * declined. Every subject is named, so a new one fails to compile until it
 * has its words, and with them its default.
 */
const wordsFor = DecisionSubject.match({
  Finish: () => acceptOrDecline,
  OpenProposal: () => acceptOrDecline,
  PostureChange: () => acceptOrDecline,
  ProxyWidened: () => acceptOrDecline,
  RaiseRatchet: () => acceptOrDecline,
  SecretInTree: () => acceptOrDecline,
  StrayPush: (): Words => ({ no: "revert", yes: "adopt" }),
  Vouch: () => acceptOrDecline,
  Waiver: () => acceptOrDecline,
});

/** Whether a choice says yes, in any subject's words. */
const saysYes = {
  accept: true,
  adopt: true,
  decline: false,
  revert: false,
} as const satisfies Record<Choice, boolean>;

/**
 * What happens when nobody decides: the subject's no. A proposal is
 * declined, a stray push reverted, a ratchet stays where it is; doing
 * nothing lets nothing in.
 */
export const defaultChoice = (subject: DecisionSubject): Choice =>
  wordsFor(subject).no;

/** `choice` as `subject`'s deciders say it: `accept` on a stray push adopts it. */
const inWords = (subject: DecisionSubject, choice: Choice): Choice => {
  const words = wordsFor(subject);

  return saysYes[choice] ? words.yes : words.no;
};

/**
 * What a decided subject asks the service to do: an accepted proposal opens
 * its ask, a reverted stray push is undone, any other yes goes ahead, and any
 * other no leaves things as they are.
 */
const consequences = (
  subject: DecisionSubject,
  choice: Choice
): readonly AttentionEffect[] => {
  if (!saysYes[choice]) {
    return DecisionSubject.guards.StrayPush(subject)
      ? [AttentionEffect.Revert({ ref: subject.ref, to: subject.before })]
      : [];
  }

  return DecisionSubject.guards.OpenProposal(subject)
    ? [AttentionEffect.OpenAsk({ proposal: subject.proposal })]
    : [AttentionEffect.Land({ subject })];
};

/** A decision taken: the decision as it now stands, and what follows from it. */
export interface Decided {
  readonly decision: Decision;
  readonly effects: readonly AttentionEffect[];
}

/** Takes `decision` with `choice`, by `by`, at `now`. */
const take = (
  decision: Decision,
  by: Handle,
  choice: Choice,
  now: DateTime.Utc,
  note: Option.Option<string>
): Decided => {
  const worded = inWords(decision.subject, choice);

  const decided = Option.match(note, {
    onNone: () => ({ at: now, by, choice: worded }),
    onSome: (text) => ({ at: now, by, choice: worded, note: text }),
  });

  return {
    decision: { ...decision, decided },
    effects: [
      ...consequences(decision.subject, worded),
      AttentionEffect.Emit({
        event: ProjectEventInput.Decided({
          at: now,
          choice: worded,
          decision: decision.id,
        }),
      }),
    ],
  };
};

/** Whether nobody may decide `decision` any more: it was taken, or it reached its expiry. */
const isClosed = (decision: Decision, now: DateTime.Utc) =>
  decision.decided !== undefined ||
  DateTime.isGreaterThanOrEqualTo(now, decision.expiresAt);

/**
 * A new decision for `deciders`, with the default its subject gives it,
 * expiring `expireDays` after `now`. The service mints the id and sets the
 * alarm at `expiresAt`.
 */
export const openDecision = (input: {
  readonly id: DecisionId;
  readonly project: ProjectName;
  readonly subject: DecisionSubject;
  readonly evidence: readonly Evidence[];
  readonly deciders: Arr.NonEmptyReadonlyArray<Handle>;
  readonly now: DateTime.Utc;
  readonly expireDays: number;
}): Decision => ({
  deciders: input.deciders,
  default: defaultChoice(input.subject),
  evidence: input.evidence,
  expiresAt: DateTime.add(input.now, { days: input.expireDays }),
  id: input.id,
  openedAt: input.now,
  project: input.project,
  subject: input.subject,
});

/**
 * One decider's choice on one open decision, recorded with who chose what
 * and when. `adopt` and `accept` both say yes, `revert` and `decline` both
 * say no, and the decision records the word its subject uses. After an
 * unknown id, a person who does not decide for it is refused before the
 * decision's state is read, so they learn nothing of it; a decision taken,
 * or past its expiry, is closed.
 */
export const decide = (
  decisions: readonly Decision[],
  input: {
    readonly id: DecisionId;
    readonly by: Handle;
    readonly choice: Choice;
    readonly note: Option.Option<string>;
    readonly now: DateTime.Utc;
  }
): Result.Result<Decided, UnknownDecision | DecisionClosed | NotDecider> => {
  const found = decisions.find(({ id }) => id === input.id);

  if (found === undefined) {
    return Result.fail(new UnknownDecision({ decision: input.id }));
  }

  if (!found.deciders.some((each) => sameHandle(each, input.by))) {
    return Result.fail(new NotDecider({}));
  }

  if (isClosed(found, input.now)) {
    return Result.fail(new DecisionClosed({ decision: input.id }));
  }

  return Result.succeed(
    take(found, input.by, input.choice, input.now, input.note)
  );
};

/** A project's decisions after an alarm, and what follows from the ones that expired. */
export interface ExpiredDecisions {
  readonly decisions: readonly Decision[];
  readonly effects: readonly AttentionEffect[];
}

/**
 * An alarm fired: every open decision past its expiry takes its default,
 * decided by the platform's own handle. The rest stay as they are, in order.
 */
export const expireDecisions = (
  decisions: readonly Decision[],
  now: DateTime.Utc
): ExpiredDecisions => {
  const steps = decisions.map((decision) =>
    isClosed(decision, now) && decision.decided === undefined
      ? take(decision, platformHandle, decision.default, now, Option.none())
      : { decision, effects: [] }
  );

  return {
    decisions: steps.map(({ decision }) => decision),
    effects: steps.flatMap(({ effects }) => effects),
  };
};

/**
 * Who decides for `paths`: everyone named by a glob in the policy's
 * `deciders` that matches one of them, in the policy's order, each once.
 * `**` matches every path, so whoever holds it decides everything. A
 * decision about no path (a vouch, a posture change) goes to the project's
 * own deciders, those of `**`.
 */
export const decidersFor = (
  policy: Policy,
  paths: readonly RepoPath[]
): readonly Handle[] => {
  const holds = (glob: string) =>
    Arr.isReadonlyArrayNonEmpty(paths)
      ? paths.some((path) => matchGlob(glob, path))
      : glob === "**";

  return Arr.dedupe(
    policy.deciders.flatMap(({ handles, paths: glob }) =>
      holds(glob) ? handles : []
    )
  );
};
