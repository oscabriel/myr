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

interface Words {
  readonly no: Choice;
  readonly yes: Choice;
}

const acceptOrDecline: Words = { no: "decline", yes: "accept" };

const wordsFor = DecisionSubject.match({
  Finish: () => acceptOrDecline,
  PostureChange: () => acceptOrDecline,
  ProxyWidened: () => acceptOrDecline,
  RaiseRatchet: () => acceptOrDecline,
  SecretInTree: () => acceptOrDecline,
  StrayPush: (): Words => ({ no: "revert", yes: "adopt" }),
  Vouch: () => acceptOrDecline,
  Waiver: () => acceptOrDecline,
});

const saysYes = {
  accept: true,
  adopt: true,
  decline: false,
  revert: false,
} as const satisfies Record<Choice, boolean>;

export const defaultChoice = (subject: DecisionSubject): Choice =>
  wordsFor(subject).no;

const inWords = (subject: DecisionSubject, choice: Choice): Choice => {
  const words = wordsFor(subject);

  return saysYes[choice] ? words.yes : words.no;
};

const consequences = (
  subject: DecisionSubject,
  choice: Choice
): readonly AttentionEffect[] => {
  if (!saysYes[choice]) {
    return DecisionSubject.guards.StrayPush(subject)
      ? [AttentionEffect.Revert({ ref: subject.ref, to: subject.before })]
      : [];
  }

  return [AttentionEffect.Land({ subject })];
};

export interface Decided {
  readonly decision: Decision;
  readonly effects: readonly AttentionEffect[];
}

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

const isClosed = (decision: Decision, now: DateTime.Utc) =>
  decision.decided !== undefined ||
  DateTime.isGreaterThanOrEqualTo(now, decision.expiresAt);

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

// A non-maintainer is refused before the decision's state is read, so they learn
// nothing of it.
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

export interface ExpiredDecisions {
  readonly decisions: readonly Decision[];
  readonly effects: readonly AttentionEffect[];
}

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
