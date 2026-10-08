/**
 * Proposals: how a person who is not a decider asks for an ask, or flags one
 * that is wrong. Anyone not denounced may, up to a cap of open proposals per
 * person, and every proposal expires on its own unless a decider accepts it
 * (expiry, not the cap, is what bounds a flood). Pure, like the lifecycles:
 * `now` is an argument, and what follows comes back as effects.
 *
 * A proposal never opens an ask by itself. The service opens an
 * `OpenProposal` decision beside it, and only a decider's `accept` opens the
 * ask (`OpenAsk`), red first like any other.
 */
import type { Policy } from "@repo/protocol/domain/policy";
import type { Proposal } from "@repo/protocol/domain/proposal";
import type {
  AskId,
  CommitSha,
  ProjectName,
  ProposalId,
  RepoName,
  RepoPath,
} from "@repo/protocol/ids";
import type { Person } from "@repo/protocol/principal";
import { CapReached, Denounced, NotVouched } from "@repo/protocol/refusal";
import { Data, DateTime, Option, Result } from "effect";

import { ProjectEventInput } from "../events.ts";
import { AttentionEffect } from "./effects.ts";

/**
 * What every proposal command carries: the id the service minted, the
 * project, the person proposing, and what the service knows about them that
 * a proposal does not: how many of their proposals are open (`openCount`,
 * against the cap) and whether the vouch file denounces them.
 */
interface Proposer {
  readonly denounced: boolean;
  /** Minted from the project's sequence. */
  readonly id: ProposalId;
  readonly openCount: number;
  readonly project: ProjectName;
  readonly who: Person;
}

/** A sealed answer: a commit in the proposer's fork, judged once the ask opens. */
interface Sealed {
  readonly fork: RepoName;
  readonly head: CommitSha;
}

/**
 * What a person can put to a project's deciders. `Propose` asks for a new
 * ask; `Flag` says an existing one is wrong (its check, its want, its
 * territory), the legal exit for whoever finds an ask they cannot answer
 * honestly. `vouched` and `recordInArea` (their landings that count in the
 * proposal's area) are the service's to work out.
 */
export type ProposalCommand = Data.TaggedEnum<{
  Flag: Proposer & { readonly ask: AskId; readonly reason: string };
  Propose: Proposer & {
    /** The proposed ask file and its check, held as rows until accepted. */
    readonly files: readonly RepoPath[];
    readonly recordInArea: number;
    readonly sealed: Option.Option<Sealed>;
    readonly territory: Option.Option<string>;
    readonly vouched: boolean;
    readonly want: string;
  };
}>;

/** Constructors for proposal commands. */
export const ProposalCommand = Data.taggedEnum<ProposalCommand>();

type Propose = Data.TaggedEnum.Value<ProposalCommand, "Propose">;

/** A proposal opened: the proposal and what the service does next. */
export interface Proposed {
  readonly effects: readonly AttentionEffect[];
  readonly proposal: Proposal;
}

/**
 * Whether a new ask's proposer lacks a vouch the project needs: under `all`
 * every proposal needs one; under `forCode` only one that carries a sealed
 * answer (that is code); under `bansOnly` none does. A flag never needs one,
 * since it changes no code.
 */
const lacksVouch = (policy: Policy, { sealed, vouched }: Propose) => {
  const { mode } = policy.vouch;

  return (
    !vouched &&
    (mode === "all" || (mode === "forCode" && Option.isSome(sealed)))
  );
};

/**
 * Whether a person may put a proposal to the deciders. A denouncement bars
 * everyone it names, in every mode; then a missing vouch. The cap comes
 * last: it is the only refusal that waiting can lift.
 */
const admit = (
  policy: Policy,
  { denounced, openCount }: Proposer,
  unvouched: boolean
): Result.Result<void, CapReached | Denounced | NotVouched> => {
  const cap = policy.caps.proposalsPerPerson;

  if (denounced) {
    return Result.fail(new Denounced({}));
  }

  if (unvouched) {
    return Result.fail(new NotVouched({}));
  }

  return openCount >= cap ? Result.fail(new CapReached({ cap })) : Result.void;
};

/** The fields every proposal opens with, expiring after the policy's days. */
const opening = (policy: Policy, proposer: Proposer, now: DateTime.Utc) => ({
  expiresAt: DateTime.add(now, { days: policy.budget.expireDays }),
  id: proposer.id,
  openedAt: now,
  project: proposer.project,
  proposer: proposer.who.handle,
  state: "open" as const,
});

/**
 * A new ask's proposal. A sealed answer keeps the first-answer slot only
 * when its proposer has a record in the area: then it stays on the
 * proposal and is judged first once the ask opens. Without one it is
 * dropped, so the proposer is credited `Asked-by` only and the ask opens to
 * everyone.
 */
const proposalFor = (
  policy: Policy,
  command: Propose,
  now: DateTime.Utc
): Proposal => {
  const proposal: Proposal = {
    ...opening(policy, command, now),
    files: command.files,
    want: command.want,
  };

  const territory = Option.match(command.territory, {
    onNone: () => proposal,
    onSome: (named) => ({ ...proposal, territory: named }),
  });

  const firstAnswer = Option.filter(
    command.sealed,
    () => command.recordInArea > 0
  );

  return Option.match(firstAnswer, {
    onNone: () => territory,
    onSome: (sealed) => ({ ...territory, sealed }),
  });
};

/** The proposal opened, with an alarm at its expiry and an event for watchers. */
const opened = (proposal: Proposal, now: DateTime.Utc): Proposed => ({
  effects: [
    AttentionEffect.SetAlarm({ at: proposal.expiresAt }),
    AttentionEffect.Emit({
      event: ProjectEventInput.ProposalOpened({
        at: now,
        proposal: proposal.id,
      }),
    }),
  ],
  proposal,
});

/**
 * Opens a proposal, or refuses it with a refusal that changes nothing. A
 * flag becomes a proposal whose `flags` is the ask and whose want is the
 * reason. Either one expires `budget.expireDays` after `now`.
 */
export const propose = (
  policy: Policy,
  command: ProposalCommand,
  now: DateTime.Utc
): Result.Result<Proposed, CapReached | Denounced | NotVouched> =>
  ProposalCommand.$match(command, {
    Flag: (flag) =>
      Result.map(admit(policy, flag, false), () =>
        opened(
          {
            ...opening(policy, flag, now),
            files: [],
            flags: flag.ask,
            want: flag.reason,
          },
          now
        )
      ),
    Propose: (proposing) =>
      Result.map(admit(policy, proposing, lacksVouch(policy, proposing)), () =>
        opened(proposalFor(policy, proposing, now), now)
      ),
  });

/** A project's proposals after an alarm, and what follows from the ones that expired. */
export interface ExpiredProposals {
  readonly effects: readonly AttentionEffect[];
  readonly proposals: readonly Proposal[];
}

/**
 * An alarm fired: every open proposal at or past its expiry expires. The
 * rest stay as they are, in order.
 *
 * It emits nothing of its own: the proposal's `OpenProposal` decision
 * expires at the same moment, and its `Decided` event (the default,
 * `decline`) is what watchers hear. `ProjectEvent` has no event for a
 * proposal closing.
 */
export const expire = (
  proposals: readonly Proposal[],
  now: DateTime.Utc
): ExpiredProposals => ({
  effects: [],
  proposals: proposals.map((proposal) =>
    proposal.state === "open" &&
    DateTime.isGreaterThanOrEqualTo(now, proposal.expiresAt)
      ? { ...proposal, state: "expired" }
      : proposal
  ),
});
