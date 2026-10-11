/**
 * A project's code as its readers browse it, read from its canonical repo
 * only (no payload names a repo, so no fork or layer can be named, principle
 * 7): refs, trees, every path, files, the first-parent log, a commit's diff
 * and why each line is there. Host-free: both the platform's handlers and
 * the web's dev world call these with the `RepoHost` they run on, and
 * consult the project's record only for main's landed commit, its landings
 * and its forks (`CodeProject`). Reads by object id go through `CodeCache`.
 *
 * Each read lives in its own module under `code/`.
 */
import type { RepoHost } from "@repo/artifacts/repo-host";
import type {
  CommitDiff,
  CommitView,
  ForkRef,
  PathList,
  RefsView,
  Rev,
  FileView,
  TreeListing,
  WhyView,
} from "@repo/protocol/domain/code";
import type { LandingView } from "@repo/protocol/domain/landing";
import { keyOf, RepoName } from "@repo/protocol/ids";
import type {
  CommitSha,
  LandedSha,
  ProjectName,
  RepoPath,
} from "@repo/protocol/ids";
import type {
  UnknownCommit,
  UnknownPath,
  UnknownRevision,
} from "@repo/protocol/refusal";
import { Effect, Option } from "effect";

import { commitDiff } from "./code/commit.ts";
import { fileView } from "./code/file.ts";
import { logPage } from "./code/log.ts";
import { pathList } from "./code/paths.ts";
import { refsView } from "./code/refs.ts";
import { listing } from "./code/tree.ts";
import { whyView } from "./code/why.ts";
import type { ProjectApi } from "./project.ts";

/** What the code reads take from a project's record, beside its canonical repo. */
export interface CodeProject {
  /** The project, as its refs name it. */
  readonly project: ProjectName;
  /** The project's canonical repo: never a fork's or a layer's. */
  readonly repo: RepoName;
  /** Main's landed commit; none before the first push. */
  readonly head: Effect.Effect<Option.Option<LandedSha>>;
  /** The landings among `shas`, so a forged trailer never reads as one. */
  readonly landings: (
    shas: readonly CommitSha[]
  ) => Effect.Effect<readonly LandingView[]>;
  readonly forks: Effect.Effect<readonly ForkRef[]>;
}

/** The code reads' view of `project`, through its `ProjectApi`. */
export const codeProjectOf = (
  api: ProjectApi,
  project: ProjectName
): CodeProject => ({
  forks: api.forks(),
  head: Effect.map(api.head(), ({ landed }) => Option.fromUndefinedOr(landed)),
  landings: api.landings,
  project,
  repo: RepoName.make(keyOf(project)),
});

/** Main's landed commit, its tags peeled and sorted newest first, and its forks. */
export const refsOf = (
  project: CodeProject
): Effect.Effect<RefsView, never, RepoHost> => refsView(project);

/** One folder at `at` (main when none), folders first, with its README. */
export const treeOf = (
  project: CodeProject,
  at: Option.Option<Rev>,
  path: Option.Option<RepoPath>
): Effect.Effect<TreeListing, UnknownRevision | UnknownPath, RepoHost> =>
  listing(project, at, path);

/** Every file path at `at`, up to the cap. */
export const pathsOf = (
  project: CodeProject,
  at: Option.Option<Rev>
): Effect.Effect<PathList, UnknownRevision, RepoHost> => pathList(project, at);

/** One file at `at`: its text, or that it is binary or too large. */
export const fileOf = (
  project: CodeProject,
  at: Option.Option<Rev>,
  path: RepoPath
): Effect.Effect<FileView, UnknownRevision | UnknownPath, RepoHost> =>
  fileView(project, at, path);

/** A page of first-parent commits from `at`, each landing with its record. */
export const logOf = (
  project: CodeProject,
  input: {
    readonly at: Option.Option<Rev>;
    readonly path: Option.Option<RepoPath>;
    readonly from: number;
    readonly limit: number;
  }
): Effect.Effect<
  { readonly commits: readonly CommitView[]; readonly next?: number },
  UnknownRevision,
  RepoHost
> => logPage(project, input);

/** One commit and the files it changed against its first parent. */
export const commitOf = (
  project: CodeProject,
  sha: CommitSha
): Effect.Effect<CommitDiff, UnknownCommit, RepoHost> =>
  commitDiff(project, sha);

/** Why each line of a file at `at` is there. */
export const whyOf = (
  project: CodeProject,
  at: Option.Option<Rev>,
  path: RepoPath
): Effect.Effect<WhyView, UnknownRevision | UnknownPath, RepoHost> =>
  whyView(project, at, path);
