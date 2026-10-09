import { Schema } from "effect";

import {
  AskId,
  CommitSha,
  Handle,
  LaneName,
  ProjectName,
  ProposalId,
  RepoName,
  RepoPath,
} from "../ids.ts";
import { AtLeastOne } from "./common.ts";

/** Where a proposal stands; an open one expires unless a decider accepts it. */
export const ProposalState = Schema.Literals([
  "open",
  "accepted",
  "declined",
  "expired",
]);

export type ProposalState = typeof ProposalState.Type;

/** What a member asks a draft to do differently, for the agent to read. */
export const DraftNote = Schema.String.check(Schema.isMaxLength(2000));

/**
 * Where the platform's draft of a proposal's ask stands: drafting (with the
 * note the round was asked with, if any), ready
 * (its check failed on main red first, in `lane`, the way `signature`
 * says), or failed after its attempts, with the last refusal's tag.
 */
export const DraftState = Schema.TaggedUnion({
  Drafting: {
    note: Schema.optionalKey(DraftNote),
    round: AtLeastOne,
    startedAt: Schema.DateTimeUtcFromString,
  },
  Failed: {
    attempts: AtLeastOne,
    model: Schema.NonEmptyString,
    refusal: Schema.NonEmptyString,
    round: AtLeastOne,
  },
  Ready: {
    attempts: AtLeastOne,
    model: Schema.NonEmptyString,
    red: Schema.Struct({ lane: LaneName, signature: Schema.NonEmptyString }),
    round: AtLeastOne,
  },
});

export type DraftState = typeof DraftState.Type;

/**
 * A proposal: a request to open an ask, from anyone not denounced, that
 * expires unless a decider accepts it. It may carry a sealed answer, judged
 * after the ask opens without the decider reading its diff.
 */
export const Proposal = Schema.Struct({
  /** The platform's draft of its ask, when the proposer asked for one. */
  draft: Schema.optionalKey(DraftState),
  expiresAt: Schema.DateTimeUtcFromString,
  /** The proposed ask file and its check, held until the proposal is accepted. */
  files: Schema.Array(RepoPath),
  /** The existing ask this proposal flags, instead of a new one. */
  flags: Schema.optionalKey(AskId),
  id: ProposalId,
  openedAt: Schema.DateTimeUtcFromString,
  project: ProjectName,
  proposer: Handle,
  sealed: Schema.optionalKey(
    Schema.Struct({ fork: RepoName, head: CommitSha })
  ),
  state: ProposalState,
  territory: Schema.optionalKey(Schema.NonEmptyString),
  want: Schema.NonEmptyString,
});

export type Proposal = typeof Proposal.Type;
