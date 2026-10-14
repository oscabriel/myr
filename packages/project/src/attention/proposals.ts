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

interface Proposer {
  readonly capped: boolean;
  readonly denounced: boolean;
  readonly id: ProposalId;
  readonly openCount: number;
  readonly project: ProjectName;
  readonly who: Person;
}

interface Sealed {
  readonly fork: RepoName;
  readonly head: CommitSha;
}

export type ProposalCommand = Data.TaggedEnum<{
  Flag: Proposer & { readonly ask: AskId; readonly reason: string };
  Propose: Proposer & {
    readonly files: readonly RepoPath[];
    readonly recordInArea: number;
    readonly sealed: Option.Option<Sealed>;
    readonly territory: Option.Option<string>;
    readonly vouched: boolean;
    readonly want: string;
  };
}>;

export const ProposalCommand = Data.taggedEnum<ProposalCommand>();

export type DraftCommand = Data.TaggedEnum<{
  DraftSettled: { readonly result: DraftResult; readonly round: number };
  DraftStarted: { readonly by: Handle; readonly note?: string };
}>;

export const DraftCommand = Data.taggedEnum<DraftCommand>();

type Propose = Data.TaggedEnum.Value<ProposalCommand, "Propose">;

export interface Proposed {
  readonly effects: readonly AttentionEffect[];
  readonly proposal: Proposal;
}

const lacksVouch = (policy: Policy, { sealed, vouched }: Propose) => {
  const { mode } = policy.vouch;

  return (
    !vouched &&
    (mode === "all" || (mode === "forCode" && Option.isSome(sealed)))
  );
};

const admit = (
  policy: Policy,
  { capped, denounced, openCount }: Proposer,
  unvouched: boolean
): Result.Result<void, CapReached | Denounced | NotVouched> => {
  const cap = policy.caps.proposalsPerPerson;

  if (denounced) {
    return Result.fail(new Denounced({}));
  }

  if (unvouched) {
    return Result.fail(new NotVouched({}));
  }

  return capped && openCount >= cap
    ? Result.fail(new CapReached({ cap, limit: "proposals" }))
    : Result.void;
};

const opening = (policy: Policy, proposer: Proposer, now: DateTime.Utc) => ({
  expiresAt: DateTime.add(now, { days: policy.decisions.expireDays }),
  id: proposer.id,
  openedAt: now,
  project: proposer.project,
  proposer: proposer.who.handle,
  state: "open" as const,
});

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

export interface ExpiredProposals {
  readonly effects: readonly AttentionEffect[];
  readonly proposals: readonly Proposal[];
}

// Emits no event: the proposal's `OpenProposal` decision expires at the same
// moment, and its `Decided` event is what watchers hear.
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

export interface Drafted {
  readonly effects: readonly AttentionEffect[];
  readonly lines: readonly Evidence[];
  readonly proposal: Proposal;
}

const nextRound = (proposal: Proposal) =>
  proposal.draft === undefined ? 1 : proposal.draft.round + 1;

const drafting = (proposal: Proposal, round: number) =>
  proposal.state === "open" &&
  proposal.draft !== undefined &&
  DraftState.guards.Drafting(proposal.draft) &&
  proposal.draft.round === round;

export const draftFailedLabel = "draft failed";

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

// A failed round keeps the last ready round's files, so a maintainer can still
// accept that draft.
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
