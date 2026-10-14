import type { Ask } from "@repo/protocol/domain/ask";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { AskId, CommitSha, Handle, LandedSha } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import { constVoid, identity } from "effect/Function";

export interface Round {
  readonly at: DateTime.Utc;
  readonly head: CommitSha;
  readonly outcome: Outcome;
  readonly seq: number;
}

export interface AskProgress {
  readonly claimant?: Handle;
  readonly landed?: { readonly sha: LandedSha; readonly seq: number };
  readonly lastPush?: { readonly at: DateTime.Utc; readonly head: CommitSha };
  readonly lastSeq: number;
  /**
   * A new claim, a release or a lapse starts the ask over, so an earlier
   * answerer's refusal no longer speaks for it.
   */
  readonly latest?: Outcome;
  readonly opened?: DateTime.Utc;
  readonly rounds: readonly Round[];
}

export type Mark =
  | "checking"
  | "claimed"
  | "landed"
  | "open"
  | "refused"
  | "waiting";

export interface Family {
  readonly children: readonly { readonly ask: AskId; readonly mark: Mark }[];
  readonly landed: number;
  readonly total: number;
}

export type Move = "answerer" | "decider" | "none" | "parent" | "platform";

export const lastSeq = (events: readonly ProjectEvent[]): number => {
  let highest = 0;

  for (const { seq } of events) {
    highest = Math.max(highest, seq);
  }

  return highest;
};

const fresh: AskProgress = { lastSeq: 0, rounds: [] };

const unclaimed = ({ claimant: _held, ...rest }: AskProgress): AskProgress =>
  rest;

const startedOver = ({
  claimant: _held,
  latest: _said,
  ...rest
}: AskProgress): AskProgress => rest;

const apply = (states: Map<AskId, AskProgress>, event: ProjectEvent): void => {
  const change = (
    ask: AskId,
    step: (progress: AskProgress) => AskProgress
  ): void => {
    states.set(ask, {
      ...step(states.get(ask) ?? fresh),
      lastSeq: event.seq,
    });
  };

  ProjectEvent.match(event, {
    AskClosed: ({ ask, landing, seq }) => {
      change(ask, (progress) => ({
        ...unclaimed(progress),
        landed: { seq, sha: landing },
      }));
    },
    AskOpened: ({ ask, at }) => {
      change(ask.ask, (progress) => ({ ...progress, opened: at }));
    },
    Claimed: ({ ask, claimant }) => {
      change(ask, (progress) => ({ ...startedOver(progress), claimant }));
    },
    Decided: constVoid,
    Judged: ({ ask, at, head, outcome, seq }) => {
      change(ask, (progress) => ({
        ...progress,
        latest: outcome,
        rounds: [...progress.rounds, { at, head, outcome, seq }],
      }));
    },
    Landed: constVoid,
    Lapsed: ({ ask }) => {
      change(ask, startedOver);
    },
    DiscussionPosted: constVoid,
    LedgerAppended: constVoid,
    ProposalDrafted: constVoid,
    ProposalOpened: constVoid,
    Pushed: ({ ask, at, head }) => {
      change(ask, (progress) => ({ ...progress, lastPush: { at, head } }));
    },
    Released: ({ ask }) => {
      change(ask, startedOver);
    },
    Warned: ({ ask }) => {
      change(ask, identity);
    },
  });
};

/**
 * Applied in their number's order, each number once, so a replay heard twice or
 * out of order folds to the same map.
 */
export const askStates = (
  events: readonly ProjectEvent[]
): ReadonlyMap<AskId, AskProgress> => {
  const states = new Map<AskId, AskProgress>();
  const seen = new Set<number>();

  for (const event of events.toSorted((a, b) => a.seq - b.seq)) {
    if (!seen.has(event.seq)) {
      seen.add(event.seq);
      apply(states, event);
    }
  }

  return states;
};

export const whoseMove = (latest?: Outcome, claimant?: Handle): Move => {
  if (latest === undefined) {
    return claimant === undefined ? "none" : "answerer";
  }

  return Outcome.match(latest, {
    AwaitingDecision: (): Move => "decider",
    AwaitingFinish: (): Move => "decider",
    Checking: (): Move => "platform",
    Landed: (): Move => "none",
    Refused: (): Move => "answerer",
    WaitingOnParent: (): Move => "parent",
  });
};

export const markOf = (progress: AskProgress | undefined): Mark => {
  if (progress === undefined) {
    return "open";
  }

  if (progress.landed !== undefined) {
    return "landed";
  }

  const { claimant, latest } = progress;

  if (latest !== undefined) {
    return Outcome.match(latest, {
      AwaitingDecision: (): Mark => "waiting",
      AwaitingFinish: (): Mark => "waiting",
      Checking: (): Mark => "checking",
      Landed: (): Mark => "landed",
      Refused: (): Mark => "refused",
      WaitingOnParent: (): Mark => "waiting",
    });
  }

  return claimant === undefined ? "open" : "claimed";
};

/**
 * A listing's `blockedBy` names only the children still open, so it cannot
 * count them.
 */
export const familyMarks = (
  parent: Ask,
  states: ReadonlyMap<AskId, AskProgress>
): Family => {
  const children = parent.blockedBy.map((ask) => ({
    ask,
    mark: markOf(states.get(ask)),
  }));

  return {
    children,
    landed: children.filter(({ mark }) => mark === "landed").length,
    total: children.length,
  };
};

/**
 * A replay that already held a landing never stamps it, and a landing stamps
 * once, whether the stream or the poll brought it.
 */
export const stampsFrom = (
  previous: ReadonlyMap<AskId, AskProgress> | undefined,
  next: ReadonlyMap<AskId, AskProgress>,
  mountSeq: number
): ReadonlySet<AskId> =>
  new Set(
    [...next].flatMap(([ask, { landed }]) =>
      landed !== undefined &&
      landed.seq > mountSeq &&
      previous?.get(ask)?.landed === undefined
        ? [ask]
        : []
    )
  );
