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
import type { Evidence } from "@repo/protocol/domain/common";
import type { Policy } from "@repo/protocol/domain/policy";
import { DraftState } from "@repo/protocol/domain/proposal";
import type { Proposal } from "@repo/protocol/domain/proposal";
import type {
  AskId,
  CommitSha,
  Handle,
  ProjectName,
  ProposalId,
  RepoName,
  RepoPath,
} from "@repo/protocol/ids";
import type { Person } from "@repo/protocol/principal";
import {
  CapReached,
  Denounced,
  DraftInProgress,
  NotVouched,
  ProposalClosed,
} from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { Data, DateTime, Option, Result } from "effect";

import { DRAFT_ROUNDS, DraftResult } from "../draft-runs.ts";
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

/**
 * What moves an open proposal's draft. `DraftStarted`: the platform's
 * agent starts drafting its ask, at `by`'s request, in its first round or
 * one more (at most `DRAFT_ROUNDS`), with the note `by` asked it with, if
 * any. `DraftSettled`: a round ended, as its run reports it.
 */
export type DraftCommand = Data.TaggedEnum<{
  DraftSettled: { readonly result: DraftResult; readonly round: number };
  DraftStarted: { readonly by: Handle; readonly note?: string };
}>;

/** Constructors for draft commands. */
export const DraftCommand = Data.taggedEnum<DraftCommand>();

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

  return openCount >= cap
    ? Result.fail(new CapReached({ cap, limit: "proposals" }))
    : Result.void;
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

/**
 * A proposal's draft moved: the proposal after it, what the service does
 * next, and, once a round settles, the lines its decision's evidence adds
 * to the want, the territory and the files.
 */
export interface Drafted {
  readonly effects: readonly AttentionEffect[];
  readonly lines: readonly Evidence[];
  readonly proposal: Proposal;
}

/** The round a proposal's next draft takes: one after its last, or the first. */
const nextRound = (proposal: Proposal) =>
  proposal.draft === undefined ? 1 : proposal.draft.round + 1;

/**
 * A round that started drafting and has not settled: the proposal's
 * current one, still open.
 */
const drafting = (proposal: Proposal, round: number) =>
  proposal.state === "open" &&
  proposal.draft !== undefined &&
  DraftState.guards.Drafting(proposal.draft) &&
  proposal.draft.round === round;

/** The evidence line that says why a proposal's last draft round failed. */
export const draftFailedLabel = "draft failed";

/** What a settled round's decision says beside the want: red first and who drafted, or why it failed. */
const settledLines = (result: DraftResult): readonly Evidence[] =>
  DraftResult.match(result, {
    Failed: ({ refusal }): readonly Evidence[] => [
      { label: draftFailedLabel, value: explain([refusal])[0] ?? refusal._tag },
    ],
    Red: ({ attempts, lane, model, rationale, signature }) => [
      { label: "red first", value: `${lane}: ${signature}` },
      {
        label: "drafted by",
        value: `${model}, attempt ${attempts} of ${DRAFT_ROUNDS}`,
      },
      { label: "why this test", value: rationale },
    ],
  });

/**
 * The proposal once a round settled: its files and `Ready`, or `Failed`.
 * A failed first round leaves no files; a later one keeps the files the
 * proposal holds, which are its last ready round's (a failed round before
 * it kept none), so a decider can still accept that draft.
 */
const settledProposal = (
  proposal: Proposal,
  round: number,
  result: DraftResult
): Proposal =>
  DraftResult.match(result, {
    Failed: ({ attempts, model, refusal }): Proposal => ({
      ...proposal,
      draft: DraftState.cases.Failed.make({
        attempts,
        model,
        refusal: refusal._tag,
        round,
      }),
      files: round === 1 ? [] : proposal.files,
    }),
    Red: ({ attempts, files, lane, model, signature }): Proposal => ({
      ...proposal,
      draft: DraftState.cases.Ready.make({
        attempts,
        model,
        red: { lane, signature },
        round,
      }),
      files: files.map(({ path }) => path),
    }),
  });

/**
 * A proposal's draft, moved. `DraftStarted` drafts an open proposal in its
 * next round, refused while a round drafts, once the proposal is closed,
 * and past `DRAFT_ROUNDS`. `DraftSettled` settles the round drafting now
 * and nothing else: a stale round, a settled one, or a closed proposal
 * gives none, so a report that comes twice changes nothing.
 */
export const draft = (
  proposal: Proposal,
  command: DraftCommand,
  now: DateTime.Utc
): Result.Result<
  Option.Option<Drafted>,
  ProposalClosed | DraftInProgress | CapReached
> =>
  DraftCommand.$match(command, {
    DraftSettled: ({ result, round }) =>
      Result.succeed(
        drafting(proposal, round)
          ? Option.some({
              effects: [
                AttentionEffect.Emit({
                  event: ProjectEventInput.ProposalDrafted({
                    at: now,
                    proposal: proposal.id,
                    ready: DraftResult.guards.Red(result),
                  }),
                }),
              ],
              lines: settledLines(result),
              proposal: settledProposal(proposal, round, result),
            })
          : Option.none()
      ),
    DraftStarted: ({ note }) => {
      if (proposal.state !== "open") {
        return Result.fail(new ProposalClosed({ proposal: proposal.id }));
      }

      if (
        proposal.draft !== undefined &&
        DraftState.guards.Drafting(proposal.draft)
      ) {
        return Result.fail(DraftInProgress.of(proposal.id));
      }

      const round = nextRound(proposal);

      const started =
        note === undefined
          ? { round, startedAt: now }
          : { note, round, startedAt: now };

      return round > DRAFT_ROUNDS
        ? Result.fail(new CapReached({ cap: DRAFT_ROUNDS, limit: "drafts" }))
        : Result.succeed(
            Option.some({
              effects: [],
              lines: [],
              proposal: {
                ...proposal,
                draft: DraftState.cases.Drafting.make(started),
              },
            })
          );
    },
  });
