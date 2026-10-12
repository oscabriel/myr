import { ClaimView } from "@repo/protocol/domain/claim";
import type { Policy } from "@repo/protocol/domain/policy";
import {
  AskId,
  claimForkName,
  CommitSha,
  Handle,
  keyOf,
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

const claimFields = {
  ask: AskId,
  base: CommitSha,
  claimant: Handle,
  fork: RepoName,
  lapsesAt: Schema.DateTimeUtcFromString,
  lastPushAt: Schema.OptionFromOptionalKey(Schema.DateTimeUtcFromString),
  openedAt: Schema.DateTimeUtcFromString,
  warnsAt: Schema.DateTimeUtcFromString,
};

export const ClaimState = Schema.TaggedUnion({
  Answered: { ...claimFields, landing: LandedSha },
  Lapsed: { ...claimFields, at: Schema.DateTimeUtcFromString },
  Live: claimFields,
  Open: { ask: AskId },
  Released: claimFields,
  Warned: claimFields,
});

export type ClaimState = typeof ClaimState.Type;

export type Live = Omit<typeof ClaimState.cases.Live.Type, "_tag">;

export const ClaimCommand = Schema.TaggedUnion({
  Claim: {
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
  Land: { landing: LandedSha },
  Push: { head: CommitSha, who: Handle },
  Release: { who: Handle },
  Tick: {},
});

export type ClaimCommand = typeof ClaimCommand.Type;

export type ClaimEffect = Data.TaggedEnum<{
  Emit: { readonly event: ProjectEventInput };
  MakeFork: { readonly from: RepoName; readonly name: RepoName };
  RevokeAccess: { readonly fork: RepoName };
  SetAlarm: { readonly at: DateTime.Utc };
}>;

export const ClaimEffect = Data.taggedEnum<ClaimEffect>();

export type ClaimRefusal =
  | AskBlocked
  | AskFull
  | CapReached
  | ClaimLapsed
  | Denounced
  | NotClaimed
  | NotVouched;

export interface ClaimStep {
  readonly effects: readonly ClaimEffect[];
  readonly state: ClaimState;
}

export type ClaimResult = Result.Result<ClaimStep, ClaimRefusal>;

const stay = (state: ClaimState): ClaimResult =>
  Result.succeed({ effects: [], state });

const move = (
  state: ClaimState,
  ...effects: readonly ClaimEffect[]
): ClaimResult => Result.succeed({ effects, state });

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

const deadlines = (from: DateTime.Utc, policy: Policy["claims"]) => ({
  lapsesAt: DateTime.add(from, { milliseconds: policy.lapseAfterMs }),
  warnsAt: DateTime.add(from, { milliseconds: policy.warnAfterMs }),
});

type Claim = typeof ClaimCommand.cases.Claim.Type;

// `AskFull` comes first, so a full ask never forks.
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
    fork: claimForkName(made.project, ask, claimant),
    lastPushAt: Option.none(),
    openedAt: now,
    ...deadlines(now, policy),
  });

  return move(
    live,
    ClaimEffect.MakeFork({
      from: RepoName.make(keyOf(made.project)),
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

const unclaimed = ({ ask }: { readonly ask: AskId }) =>
  Result.fail(NotClaimed.of(ask));

const push = (
  state: ClaimState,
  { head, who }: typeof ClaimCommand.cases.Push.Type,
  now: DateTime.Utc,
  policy: Policy["claims"]
): ClaimResult => {
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

export interface ViewContext {
  readonly checkCommand: string;
  readonly project: ProjectName;
  readonly remote: string;
}

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
