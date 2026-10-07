import { Schema } from "effect";

import {
  AskId,
  CommitSha,
  Handle,
  ProjectName,
  ProposalId,
  RepoName,
  RepoPath,
} from "../ids.ts";

/** Where a proposal stands; an open one expires unless a decider accepts it. */
export const ProposalState = Schema.Literals([
  "open",
  "accepted",
  "declined",
  "expired",
]);

export type ProposalState = typeof ProposalState.Type;

/**
 * A proposal: a request to open an ask, from anyone not denounced, that
 * expires unless a decider accepts it. It may carry a sealed answer, judged
 * after the ask opens without the decider reading its diff.
 */
export const Proposal = Schema.Struct({
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
