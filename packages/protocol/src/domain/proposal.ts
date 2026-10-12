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

export const ProposalState = Schema.Literals([
  "open",
  "accepted",
  "declined",
  "expired",
]);

export type ProposalState = typeof ProposalState.Type;

export const DraftNote = Schema.String.check(Schema.isMaxLength(2000));

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

export const Proposal = Schema.Struct({
  draft: Schema.optionalKey(DraftState),
  expiresAt: Schema.DateTimeUtcFromString,
  files: Schema.Array(RepoPath),
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
