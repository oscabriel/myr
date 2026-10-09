/**
 * A project's code as its readers browse it: refs, trees, files, commits
 * and "why" per line, each read from the project's canonical repo only (no
 * payload names a repo). Every read names the 40-hex commit it resolved
 * to (`at`), so any page can become a permalink.
 */
import { Schema } from "effect";

import {
  AskId,
  BlobSha,
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

/** A tag's name, as `refs/tags/<name>` spells it: `v1.2.0`, `@changesets/cli@2.27.1`. */
export const TagName = Schema.NonEmptyString.check(
  Schema.isMaxLength(255)
).pipe(Schema.brand("TagName"));

export type TagName = typeof TagName.Type;

/**
 * A revision as a reader names it: `main` (the landed commit), a full
 * 40-hex commit id, or a tag's name. Decoded into one of the three where
 * it is read; anything else is `UnknownRevision`.
 */
export const Rev = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255)
);

export type Rev = typeof Rev.Type;

/** One tag, peeled to the commit it names. */
export const TagRef = Schema.Struct({ name: TagName, sha: CommitSha });

export type TagRef = typeof TagRef.Type;

/**
 * One fork of the project: a claim's (`<project>--<ask>--<handle>`), with
 * its ask and the claim's state, or a person's working fork.
 */
export const ForkRef = Schema.Struct({
  ask: Schema.optionalKey(AskId),
  handle: Handle,
  kind: Schema.Literals(["claim", "working"]),
  repo: RepoName,
  state: Schema.optionalKey(ClaimState),
});

export type ForkRef = typeof ForkRef.Type;

/** A project's refs as a reader sees them: main's landed commit, its tags and its forks. */
export const RefsView = Schema.Struct({
  forks: Schema.Array(ForkRef),
  landed: Schema.optionalKey(LandedSha),
  project: ProjectName,
  tags: Schema.Array(TagRef),
});

export type RefsView = typeof RefsView.Type;

/** One entry of a directory. */
export const CodeEntry = Schema.Struct({
  mode: Schema.String,
  name: Schema.NonEmptyString,
  path: RepoPath,
  sha: Schema.String,
  type: Schema.Literals(["blob", "tree", "submodule", "symlink"]),
});

export type CodeEntry = typeof CodeEntry.Type;

/** One directory at one commit: folders first, then by name, and its README when it has one. */
export const TreeListing = Schema.Struct({
  at: CommitSha,
  entries: Schema.Array(CodeEntry),
  /** Absent for the root. */
  path: Schema.optionalKey(RepoPath),
  readme: Schema.optionalKey(Schema.Struct({ path: RepoPath, sha: BlobSha })),
});

export type TreeListing = typeof TreeListing.Type;

/** Every file path at one commit, for a file tree; `truncated` past the cap. */
export const PathList = Schema.Struct({
  at: CommitSha,
  paths: Schema.Array(RepoPath),
  truncated: Schema.Boolean,
});

export type PathList = typeof PathList.Type;

/**
 * One file at one commit. `text` is absent for a binary file and for one
 * past the size cap (`truncated`).
 */
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

/** Who wrote or committed a commit, and when. */
export const Signature = Schema.Struct({
  at: Schema.DateTimeUtcFromString,
  email: Schema.String,
  name: Schema.String,
});

export type Signature = typeof Signature.Type;

/**
 * One commit as a reader sees it. `landing` is the platform's own record of
 * it, when it is a landing: a trailer in an imported commit never makes one.
 */
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

/** One file a commit changed, against its first parent. */
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

/** A commit and what it changed; past the caps, paths only and `truncated`. */
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

/**
 * Why each line of a file is there: the first-parent commit that brought
 * it, and that commit's landing when it is one. Lines older than the walk
 * reached go to `stoppedAt`.
 */
export const WhyView = Schema.Struct({
  at: CommitSha,
  commits: Schema.Array(CommitView),
  landings: Schema.Array(LandingView),
  path: RepoPath,
  ranges: Schema.Array(WhyRange),
  stoppedAt: Schema.optionalKey(CommitSha),
});

export type WhyView = typeof WhyView.Type;
