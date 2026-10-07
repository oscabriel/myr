/**
 * What Artifacts sends the `OnPush` Workflow for every ref a push moved in
 * the public namespace: S1 #15's `cf.artifacts.repo.pushed` event, verbatim
 * (S1 change 7). The Workflow decodes its params with it before anything
 * else (principle 2); its `id` is the Workflow's instance id, so a
 * redelivered event cannot start a second run (S1 change 6).
 */
import { CommitSha, RepoName } from "@repo/protocol/ids";
import { Schema } from "effect";

/** A commit's author or committer, as git records one. */
const GitIdentity = Schema.Struct({
  email: Schema.String,
  name: Schema.String,
});

/** One commit the push brought, as Artifacts lists it. */
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
    /** Where the ref points now: git's zero id when the push deleted it. */
    after: CommitSha,
    /** Where the ref pointed before: git's zero id when the push created it. */
    before: CommitSha,
    /** Empty for a ref moved to a commit the repo already held (S1 #13). */
    commits: Schema.Array(PushedCommit),
    commitsTruncated: Schema.Boolean,
    /** The one ref this event is about: each ref a push moves fires its own (S1 #13). */
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

/**
 * git's all-zero id: the `before` of a ref a push created, the `after` of
 * one it deleted. It names no commit.
 */
export const ZeroSha = CommitSha.make("0".repeat(40));

/** Whether `sha` is git's zero id, which stands for "no commit". */
export const isZero = (sha: CommitSha): boolean => sha === ZeroSha;
