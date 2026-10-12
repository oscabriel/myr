import { CommitSha, RepoName } from "@repo/protocol/ids";
import { Schema } from "effect";

const GitIdentity = Schema.Struct({
  email: Schema.String,
  name: Schema.String,
});

const PushedCommit = Schema.Struct({
  author: GitIdentity,
  committer: GitIdentity,
  id: CommitSha,
  message: Schema.String,
  messageTruncated: Schema.Boolean,
  parents: Schema.Array(CommitSha),
  timestamp: Schema.DateTimeUtcFromString,
});

export const OnPushEvent = Schema.Struct({
  id: Schema.NonEmptyString,
  payload: Schema.Struct({
    after: CommitSha,
    before: CommitSha,
    commits: Schema.Array(PushedCommit),
    commitsTruncated: Schema.Boolean,
    ref: Schema.NonEmptyString,
    totalCommitsCount: Schema.Int,
  }),
  source: Schema.Struct({
    namespace: Schema.NonEmptyString,
    repoName: RepoName,
  }),
  type: Schema.Literal("cf.artifacts.repo.pushed"),
});

export type OnPushEvent = typeof OnPushEvent.Type;

export const ZeroSha = CommitSha.make("0".repeat(40));

export const isZero = (sha: CommitSha): boolean => sha === ZeroSha;
