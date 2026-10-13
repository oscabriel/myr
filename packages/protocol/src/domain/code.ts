// Read from the project's canonical repo only: no payload names a repo.
import { Data, Option, Schema } from "effect";

import {
  AskId,
  BlobSha,
  BranchName,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
  RepoPath,
  TreeSha,
} from "../ids.ts";
import { ClaimState } from "./claim.ts";
import { LandingView } from "./landing.ts";

export const TagName = Schema.NonEmptyString.check(
  Schema.isMaxLength(255)
).pipe(Schema.brand("TagName"));

export type TagName = typeof TagName.Type;

export const packageOf = (tag: string): Option.Option<string> => {
  const at = tag.lastIndexOf("@");

  return at > 0 ? Option.some(tag.slice(0, at)) : Option.none();
};

export const Rev = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255)
);

export type Rev = typeof Rev.Type;

/** Where in a fork an address points: a branch by its exact name, or a commit the fork holds. */
export type ForkPoint = Data.TaggedEnum<{
  Branch: { readonly name: BranchName };
  Commit: { readonly sha: CommitSha };
}>;

export const ForkPoint = Data.taggedEnum<ForkPoint>();

/**
 * An answer fork named by its claimant and ask (ADR 0043), never by its repo:
 * the platform finds it among the project's listed forks.
 */
export interface ForkAddress {
  readonly ask: AskId;
  readonly handle: Handle;
  readonly point: ForkPoint;
}

const FORK = /^@(?<handle>[^/:]+)\/(?<ask>[^/:]+)(?::(?<point>.*))?$/u;

const FULL_SHA = /^[0-9a-f]{40}$/u;

const decodeHandle = Schema.decodeUnknownOption(Handle);

const decodeAsk = Schema.decodeUnknownOption(AskId);

const decodeBranch = Schema.decodeUnknownOption(BranchName);

const pointOf = (text: string | undefined): Option.Option<ForkPoint> => {
  if (text === undefined) {
    return Option.some(ForkPoint.Branch({ name: BranchName.make("main") }));
  }

  if (FULL_SHA.test(text)) {
    return Option.some(ForkPoint.Commit({ sha: CommitSha.make(text) }));
  }

  return Option.map(decodeBranch(text), (name) => ForkPoint.Branch({ name }));
};

/**
 * `@<handle>/<ask>` is the fork's `main`; `@<handle>/<ask>:<branch>` a branch
 * matched by its exact name, and `@<handle>/<ask>:<sha>` a full commit id the
 * fork holds. A closed parse: each part is decoded as its own schema, and
 * nothing read here is ever joined into a ref path.
 */
export const forkAddressOf = (rev: string): Option.Option<ForkAddress> => {
  const groups = FORK.exec(rev)?.groups;

  if (groups === undefined) {
    return Option.none();
  }

  const { ask, handle, point } = groups;

  return Option.all({
    ask: decodeAsk(ask),
    handle: decodeHandle(handle),
    point: pointOf(point),
  });
};

/** The revision that names a fork's branch (its `main` when absent) or one of its commits. */
export const forkRev = (
  fork: { readonly ask: AskId; readonly handle: Handle },
  point?: string
): Rev =>
  point === undefined || point === "main"
    ? `@${fork.handle}/${fork.ask}`
    : `@${fork.handle}/${fork.ask}:${point}`;

export const TagRef = Schema.Struct({ name: TagName, sha: CommitSha });

export type TagRef = typeof TagRef.Type;

export const ForkRef = Schema.Struct({
  ask: Schema.optionalKey(AskId),
  handle: Handle,
  kind: Schema.Literals(["claim", "working"]),
  repo: RepoName,
  state: Schema.optionalKey(ClaimState),
});

export type ForkRef = typeof ForkRef.Type;

export const RefsView = Schema.Struct({
  forks: Schema.Array(ForkRef),
  landed: Schema.optionalKey(LandedSha),
  project: ProjectName,
  tags: Schema.Array(TagRef),
});

export type RefsView = typeof RefsView.Type;

export const CodeEntry = Schema.Struct({
  mode: Schema.String,
  name: Schema.NonEmptyString,
  path: RepoPath,
  sha: Schema.String,
  type: Schema.Literals(["blob", "tree", "submodule", "symlink"]),
});

export type CodeEntry = typeof CodeEntry.Type;

export const TreeListing = Schema.Struct({
  at: CommitSha,
  entries: Schema.Array(CodeEntry),
  path: Schema.optionalKey(RepoPath),
  readme: Schema.optionalKey(Schema.Struct({ path: RepoPath, sha: BlobSha })),
});

export type TreeListing = typeof TreeListing.Type;

export const PathList = Schema.Struct({
  at: CommitSha,
  paths: Schema.Array(RepoPath),
  truncated: Schema.Boolean,
});

export type PathList = typeof PathList.Type;

export const FileView = Schema.Struct({
  at: CommitSha,
  binary: Schema.Boolean,
  path: RepoPath,
  sha: BlobSha,
  size: Schema.Int,
  text: Schema.optionalKey(Schema.String),
  truncated: Schema.Boolean,
});

export type FileView = typeof FileView.Type;

export const Signature = Schema.Struct({
  at: Schema.DateTimeUtcFromString,
  email: Schema.String,
  name: Schema.String,
});

export type Signature = typeof Signature.Type;

/** `landing` is the platform's own record: a trailer in an imported commit never makes one. */
export const CommitView = Schema.Struct({
  author: Signature,
  body: Schema.String,
  committer: Signature,
  landing: Schema.optionalKey(LandingView),
  parents: Schema.Array(CommitSha),
  sha: CommitSha,
  subject: Schema.String,
  trailers: Schema.Array(
    Schema.Struct({ key: Schema.String, value: Schema.String })
  ),
  tree: TreeSha,
});

export type CommitView = typeof CommitView.Type;

export const ChangedFile = Schema.Struct({
  after: Schema.optionalKey(BlobSha),
  before: Schema.optionalKey(BlobSha),
  binary: Schema.Boolean,
  newText: Schema.optionalKey(Schema.String),
  oldText: Schema.optionalKey(Schema.String),
  path: RepoPath,
  status: Schema.Literals(["added", "modified", "deleted"]),
});

export type ChangedFile = typeof ChangedFile.Type;

export const CommitDiff = Schema.Struct({
  commit: CommitView,
  files: Schema.Array(ChangedFile),
  truncated: Schema.Boolean,
});

export type CommitDiff = typeof CommitDiff.Type;

/** Lines `start` to `end` (1-based, inclusive) came in with commit `sha`. */
export const WhyRange = Schema.Struct({
  end: Schema.Int,
  sha: CommitSha,
  start: Schema.Int,
});

export type WhyRange = typeof WhyRange.Type;

export const WhyView = Schema.Struct({
  at: CommitSha,
  commits: Schema.Array(CommitView),
  landings: Schema.Array(LandingView),
  path: RepoPath,
  ranges: Schema.Array(WhyRange),
  stoppedAt: Schema.optionalKey(CommitSha),
});

export type WhyView = typeof WhyView.Type;
