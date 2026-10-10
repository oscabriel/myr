/**
 * Where each ask of a project stands, folded from the project's events (the
 * `watch` replay its page already reads): who holds it, its rounds, its
 * latest outcome, whether it landed; whose move that leaves; a family's
 * marks against the parent's stored children; and which landings a page
 * that is open should stamp.
 *
 * Pure functions over events, with no transport, so a view can take what
 * they return (and their types) as props.
 */
import type { Ask } from "@repo/protocol/domain/ask";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { AskId, CommitSha, Handle, LandedSha } from "@repo/protocol/ids";
import type { DateTime } from "effect";
import { constVoid, identity } from "effect/Function";

/** One answer checked: the commit pushed, what the gate said, and when. */
export interface Round {
  readonly at: DateTime.Utc;
  readonly head: CommitSha;
  readonly outcome: Outcome;
  readonly seq: number;
}

/** Where one ask stands, as its events tell it. */
export interface AskProgress {
  /** Who holds it now: the last claim, until it is released, lapses or the ask closes. */
  readonly claimant?: Handle;
  /** The landing that closed it, and that event's number. */
  readonly landed?: { readonly sha: LandedSha; readonly seq: number };
  readonly lastPush?: { readonly at: DateTime.Utc; readonly head: CommitSha };
  /** The number of the last event about it. */
  readonly lastSeq: number;
  /**
   * The last outcome of the current attempt: a new claim, a release or a
   * lapse starts the ask over, so an earlier answerer's refusal no longer
   * speaks for it (its round stays in `rounds`).
   */
  readonly latest?: Outcome;
  /** Every answer checked, oldest first. */
  readonly rounds: readonly Round[];
}

/** One child's place in its family. */
export type Mark =
  | "checking"
  | "claimed"
  | "landed"
  | "open"
  | "refused"
  | "waiting";

/** A family's progress: each stored child's mark, in order, and how many landed of how many. */
export interface Family {
  readonly children: readonly { readonly ask: AskId; readonly mark: Mark }[];
  readonly landed: number;
  readonly total: number;
}

/** Who acts next on an ask. */
export type Move = "answerer" | "decider" | "family" | "none" | "platform";

/** The highest event number among `events`; 0 when there are none. */
export const lastSeq = (events: readonly ProjectEvent[]): number => {
  let highest = 0;

  for (const { seq } of events) {
    highest = Math.max(highest, seq);
  }

  return highest;
};

const fresh: AskProgress = { lastSeq: 0, rounds: [] };

/** `progress` with nobody holding the ask. */
const unclaimed = ({ claimant: _held, ...rest }: AskProgress): AskProgress =>
  rest;

/** `progress` started over: nobody holds the ask, and no outcome speaks for it. */
const startedOver = ({
  claimant: _held,
  latest: _said,
  ...rest
}: AskProgress): AskProgress => rest;

/** `event` applied to `states`, when it is about one ask. */
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
    AskOpened: ({ ask }) => {
      change(ask.ask, identity);
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
 * Where each ask stands, from a project's events: applied in their number's
 * order, each number once, so a replay heard twice or out of order folds to
 * the same map.
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

/**
 * Who acts next, from the latest outcome alone: a refusal leaves it to the
 * answerer, a wait on a decision or a finish to a decider, a check under
 * way to the platform, a wait on the parent to the rest of its family. With
 * nothing judged yet, a claimed ask is its answerer's to push and an open
 * one nobody's in particular.
 */
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
    WaitingOnParent: (): Move => "family",
  });
};

/** One child's mark: landed first, then what its latest outcome says, then whether someone holds it. */
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
 * A family's marks: one per child the parent stores (`showAsk(parent)`'s
 * `blockedBy`, in its order), and how many of them landed. A listing's
 * `blockedBy` names only the children still open, so it cannot count them.
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
 * The asks whose landing a page that is open should stamp: landed in
 * `next`, not in `previous` (the read before; none for the first read), and
 * closed by an event after the highest number of the first read the page
 * settled on (`mountSeq`). A replay that already held a landing never
 * stamps it, and a landing stamps once, whether the stream or the poll
 * brought it.
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
