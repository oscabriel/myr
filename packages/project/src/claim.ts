/**
 * The claim lifecycle (ADR 0012): one person's exclusive, expiring right to
 * answer an ask, moved only by `transition`. It reads no clock and calls no
 * port: `now` is an argument, and what should happen next comes back as data
 * (`ClaimEffect`) for the project service to settle.
 */
import { ClaimView } from "@repo/protocol/domain/claim";
import type { Policy } from "@repo/protocol/domain/policy";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
} from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import {
  AskBlocked,
  AskFull,
  CapReached,
  ClaimLapsed,
  Denounced,
  NotClaimed,
  NotVouched,
} from "@repo/protocol/refusal";
import { Array as Arr, Data, DateTime, Option, Result, Schema } from "effect";

import { ProjectEventInput } from "./events.ts";

/** What a claim holds while it lasts, and keeps once it ends. */
const claimFields = {
  ask: AskId,
  /** Main's landed commit when the claim was made. */
  base: CommitSha,
  claimant: Handle,
  /** The claim's fork: `<project>--<ask>--<handle in lowercase>`. */
  fork: RepoName,
  /** The last push (or the claim) plus the policy's `lapseAfterMs`. */
  lapsesAt: Schema.DateTimeUtcFromString,
  lastPushAt: Schema.OptionFromOptionalKey(Schema.DateTimeUtcFromString),
  openedAt: Schema.DateTimeUtcFromString,
  /** The last push (or the claim) plus the policy's `warnAfterMs`. */
  warnsAt: Schema.DateTimeUtcFromString,
};

/**
 * Where one claim on an ask stands. `Open` holds no claim; `Live` and
 * `Warned` are live; `Lapsed`, `Released` and `Answered` keep the claim they
 * ended. Encoded, it is JSON, so the project store persists it as is.
 */
export const ClaimState = Schema.TaggedUnion({
  /** The claimant's answer landed. */
  Answered: { ...claimFields, landing: LandedSha },
  /** No push came in time; the claimant may push no more. */
  Lapsed: { ...claimFields, at: Schema.DateTimeUtcFromString },
  Live: claimFields,
  Open: { ask: AskId },
  /** The claimant gave the claim up. */
  Released: claimFields,
  /** Live, but quiet for long enough that the claimant was warned. */
  Warned: claimFields,
});

export type ClaimState = typeof ClaimState.Type;

/** A claim's fields, which `Live` and `Warned` hold and the ended states keep. */
export type Live = Omit<typeof ClaimState.cases.Live.Type, "_tag">;

/**
 * What can happen to a claim. `Claim` carries what the project service knows
 * and the lifecycle does not: how many claims the person holds (`heldByWho`)
 * against their `cap`, how many others hold a live claim on the ask
 * (`liveCount`) against the kind's `race`, the person's standing, and the
 * asks this one waits on.
 */
export const ClaimCommand = Schema.TaggedUnion({
  Claim: {
    /** Main's landed commit now. */
    base: CommitSha,
    blockedBy: Schema.Array(AskId),
    cap: Schema.Int,
    denounced: Schema.Boolean,
    heldByWho: Schema.Int,
    liveCount: Schema.Int,
    project: ProjectName,
    race: Schema.Int,
    vouched: Schema.Boolean,
    who: Person,
  },
  /** The claimant's answer landed on main. */
  Land: { landing: LandedSha },
  /** A push reached the claim's fork. */
  Push: { head: CommitSha, who: Handle },
  Release: { who: Handle },
  /** An alarm fired: a deadline may have passed. */
  Tick: {},
});

export type ClaimCommand = typeof ClaimCommand.Type;

/** What the project service does after a transition, in order. */
export type ClaimEffect = Data.TaggedEnum<{
  Emit: { readonly event: ProjectEventInput };
  /** Fork the canonical repo; a retried fork converges on the same one. */
  MakeFork: { readonly from: RepoName; readonly name: RepoName };
  /** The claimant may push to the fork no more; the fork stays. */
  RevokeAccess: { readonly fork: RepoName };
  SetAlarm: { readonly at: DateTime.Utc };
}>;

export const ClaimEffect = Data.taggedEnum<ClaimEffect>();

/** Every way the claim lifecycle says no. */
export type ClaimRefusal =
  | AskBlocked
  | AskFull
  | CapReached
  | ClaimLapsed
  | Denounced
  | NotClaimed
  | NotVouched;

/** A transition's result: the next state and the effects that settle it. */
export interface ClaimStep {
  readonly effects: readonly ClaimEffect[];
  readonly state: ClaimState;
}

/** A claim's fork: `<project>--<ask>--<handle in lowercase>` (spec §4.5). */
export const forkName = (project: ProjectName, ask: AskId, handle: Handle) =>
  RepoName.make(`${project}--${ask}--${handle.toLowerCase()}`);

/** What `transition` returns: a step, or the refusal that changes nothing. */
export type ClaimResult = Result.Result<ClaimStep, ClaimRefusal>;

/** The state as it is, with nothing to settle: how a repeated command converges. */
const stay = (state: ClaimState): ClaimResult =>
  Result.succeed({ effects: [], state });

const move = (
  state: ClaimState,
  ...effects: readonly ClaimEffect[]
): ClaimResult => Result.succeed({ effects, state });

/** A claim's own fields, whatever state holds them. */
const claimOf = ({
  ask,
  base,
  claimant,
  fork,
  lapsesAt,
  lastPushAt,
  openedAt,
  warnsAt,
}: Live): Live => ({
  ask,
  base,
  claimant,
  fork,
  lapsesAt,
  lastPushAt,
  openedAt,
  warnsAt,
});

/** When a claim quiet since `from` is warned, and when it lapses. */
const deadlines = (from: DateTime.Utc, policy: Policy["claims"]) => ({
  lapsesAt: DateTime.add(from, { milliseconds: policy.lapseAfterMs }),
  warnsAt: DateTime.add(from, { milliseconds: policy.warnAfterMs }),
});

type Claim = typeof ClaimCommand.cases.Claim.Type;

/**
 * A new claim on an ask its maker does not hold. `AskFull` comes first, so a
 * full ask never forks (ADR 0008); then the ask's blockers, the person's cap,
 * and their standing, a denouncement before a missing vouch.
 */
const grant = (
  ask: AskId,
  made: Claim,
  now: DateTime.Utc,
  policy: Policy["claims"]
): ClaimResult => {
  if (made.liveCount >= made.race) {
    return Result.fail(new AskFull({ ask }));
  }

  if (Arr.isReadonlyArrayNonEmpty(made.blockedBy)) {
    return Result.fail(AskBlocked.of(ask, made.blockedBy));
  }

  if (made.heldByWho >= made.cap) {
    return Result.fail(new CapReached({ cap: made.cap }));
  }

  if (made.denounced) {
    return Result.fail(new Denounced({}));
  }

  if (!made.vouched) {
    return Result.fail(new NotVouched({}));
  }

  const claimant = made.who.handle;

  const live = ClaimState.cases.Live.make({
    ask,
    base: made.base,
    claimant,
    fork: forkName(made.project, ask, claimant),
    lastPushAt: Option.none(),
    openedAt: now,
    ...deadlines(now, policy),
  });

  return move(
    live,
    ClaimEffect.MakeFork({
      from: RepoName.make(made.project),
      name: live.fork,
    }),
    ClaimEffect.SetAlarm({ at: live.warnsAt }),
    ClaimEffect.Emit({
      event: ProjectEventInput.Claimed({ ask, at: now, claimant }),
    })
  );
};

const claim = (
  state: ClaimState,
  made: Claim,
  now: DateTime.Utc,
  policy: Policy["claims"]
): ClaimResult => {
  // A live claim is its holder's to keep, and nobody else's to take.
  const holder = (live: Live) =>
    live.claimant === made.who.handle
      ? stay(state)
      : Result.fail(new AskFull({ ask: live.ask }));

  return ClaimState.match(state, {
    Answered: ({ ask }) => Result.fail(new AskFull({ ask })),
    Lapsed: ({ ask }) => grant(ask, made, now, policy),
    Live: holder,
    Open: ({ ask }) => grant(ask, made, now, policy),
    Released: ({ ask }) => grant(ask, made, now, policy),
    Warned: holder,
  });
};

/** Whoever holds no live claim on the ask. */
const unclaimed = ({ ask }: { readonly ask: AskId }) =>
  Result.fail(NotClaimed.of(ask));

const push = (
  state: ClaimState,
  { head, who }: typeof ClaimCommand.cases.Push.Type,
  now: DateTime.Utc,
  policy: Policy["claims"]
): ClaimResult => {
  // The holder's push starts both deadlines again from now.
  const kept = (live: Live) => {
    if (live.claimant !== who) {
      return Result.fail(NotClaimed.of(live.ask));
    }

    const pushed = ClaimState.cases.Live.make({
      ...claimOf(live),
      lastPushAt: Option.some(now),
      ...deadlines(now, policy),
    });

    return move(
      pushed,
      ClaimEffect.SetAlarm({ at: pushed.warnsAt }),
      ClaimEffect.Emit({
        event: ProjectEventInput.Pushed({ ask: live.ask, at: now, head }),
      })
    );
  };

  return ClaimState.match(state, {
    Answered: unclaimed,
    Lapsed: (lapsed) =>
      lapsed.claimant === who
        ? Result.fail(ClaimLapsed.of(lapsed.ask))
        : unclaimed(lapsed),
    Live: kept,
    Open: unclaimed,
    Released: unclaimed,
    Warned: kept,
  });
};

const tick = (state: ClaimState, now: DateTime.Utc): ClaimResult => {
  const reached = (deadline: DateTime.Utc) =>
    DateTime.isGreaterThanOrEqualTo(now, deadline);

  // An alarm that comes late lapses the claim without warning it first.
  const lapse = (live: Live) =>
    move(
      ClaimState.cases.Lapsed.make({ ...claimOf(live), at: now }),
      ClaimEffect.RevokeAccess({ fork: live.fork }),
      ClaimEffect.Emit({
        event: ProjectEventInput.Lapsed({ ask: live.ask, at: now }),
      })
    );

  const warn = (live: Live) =>
    move(
      ClaimState.cases.Warned.make(claimOf(live)),
      ClaimEffect.SetAlarm({ at: live.lapsesAt }),
      ClaimEffect.Emit({
        event: ProjectEventInput.Warned({ ask: live.ask, at: now }),
      })
    );

  return ClaimState.match(state, {
    Answered: stay,
    Lapsed: stay,
    Live: (live) => {
      if (reached(live.lapsesAt)) {
        return lapse(live);
      }

      return reached(live.warnsAt) ? warn(live) : stay(state);
    },
    Open: stay,
    Released: stay,
    Warned: (warned) =>
      reached(warned.lapsesAt) ? lapse(warned) : stay(state),
  });
};

const release = (
  state: ClaimState,
  who: Handle,
  now: DateTime.Utc
): ClaimResult => {
  const end = (live: Live) =>
    live.claimant === who
      ? move(
          ClaimState.cases.Released.make(claimOf(live)),
          ClaimEffect.RevokeAccess({ fork: live.fork }),
          ClaimEffect.Emit({
            event: ProjectEventInput.Released({ ask: live.ask, at: now }),
          })
        )
      : Result.fail(NotClaimed.of(live.ask));

  // A claim that already ended stays ended: releasing it again converges.
  const ended = (claimed: Live) =>
    claimed.claimant === who
      ? stay(state)
      : Result.fail(NotClaimed.of(claimed.ask));

  return ClaimState.match(state, {
    Answered: ended,
    Lapsed: ended,
    Live: end,
    Open: unclaimed,
    Released: ended,
    Warned: end,
  });
};

/**
 * The claimant's answer landed. A live claim's access ends with it; a lapsed
 * claim's already has. A released claim stays released, and an ask that holds
 * no claim (a decider's own landing) is left as it is.
 */
const land = (state: ClaimState, landing: LandedSha): ClaimResult => {
  const answer = (live: Live, ...effects: readonly ClaimEffect[]) =>
    move(
      ClaimState.cases.Answered.make({ ...claimOf(live), landing }),
      ...effects
    );

  const revoked = (live: Live) =>
    answer(live, ClaimEffect.RevokeAccess({ fork: live.fork }));

  return ClaimState.match(state, {
    Answered: stay,
    Lapsed: (lapsed) => answer(lapsed),
    Live: revoked,
    Open: stay,
    Released: stay,
    Warned: revoked,
  });
};

/**
 * The one way a claim moves: the next state and the effects that settle it,
 * or a refusal, which changes nothing. Deadlines become `SetAlarm` effects and
 * an alarm comes back as `Tick`. Pure: the same arguments give the same
 * result, so a replayed command converges.
 */
export const transition = (
  state: ClaimState,
  command: ClaimCommand,
  now: DateTime.Utc,
  policy: Policy["claims"]
): ClaimResult =>
  ClaimCommand.match(command, {
    Claim: (made) => claim(state, made, now, policy),
    Land: ({ landing }) => land(state, landing),
    Push: (pushed) => push(state, pushed, now, policy),
    Release: ({ who }) => release(state, who, now),
    Tick: () => tick(state, now),
  });

/** Where the claim's fork is served and what to run, for the claim's view. */
export interface ViewContext {
  /** What `<cli> check` runs locally for the ask; not empty. */
  readonly checkCommand: string;
  readonly project: ProjectName;
  /** The fork's URL at the gateway; not empty. */
  readonly remote: string;
}

/**
 * The claim as its claimant sees it, in whichever state it is or ended in;
 * none while the ask holds no claim.
 */
export const toView = (
  state: ClaimState,
  context: ViewContext
): Option.Option<ClaimView> => {
  const view = (claimed: Live, standing: ClaimView["state"]) => {
    const shown = {
      ask: claimed.ask,
      base: claimed.base,
      checkCommand: context.checkCommand,
      claimant: claimed.claimant,
      fork: claimed.fork,
      lapsesAt: claimed.lapsesAt,
      openedAt: claimed.openedAt,
      project: context.project,
      remote: context.remote,
      state: standing,
      warnsAt: claimed.warnsAt,
    };

    return Option.some(
      ClaimView.make(
        Option.match(claimed.lastPushAt, {
          onNone: () => shown,
          onSome: (lastPushAt) => ({ ...shown, lastPushAt }),
        })
      )
    );
  };

  return ClaimState.match(state, {
    Answered: (answered) => view(answered, "answered"),
    Lapsed: (lapsed) => view(lapsed, "lapsed"),
    Live: (live) => view(live, "live"),
    Open: () => Option.none(),
    Released: (released) => view(released, "released"),
    Warned: (warned) => view(warned, "warned"),
  });
};
