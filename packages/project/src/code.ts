/**
 * A project's code as its readers browse it, read from its canonical repo
 * only (no payload names a repo, so no fork or layer can be named, principle
 * 7): refs, trees, every path, files, the first-parent log, a commit's diff
 * and why each line is there. Host-free: both the platform's handlers and
 * the web's dev world call these with the `RepoHost` they run on, and
 * consult the project's record only for main's landed commit, its landings
 * and its forks (`CodeProject`). Reads by object id go through `CodeCache`.
 *
 * Stubs until 903 (every read but `whyOf`) and 912 (`whyOf`) land; the
 * signatures are final.
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
import { RepoName } from "@repo/protocol/ids";
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

import type { ProjectApi } from "./project.ts";

/** What the code reads take from a project's record, beside its canonical repo. */
export interface CodeProject {
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
  repo: RepoName.make(project),
});

const notBuilt = (issue: string) => Effect.die(`not built: ${issue}`);

/** Main's landed commit, its tags peeled and sorted newest first, and its forks. */
export const refsOf = (
  _project: CodeProject
): Effect.Effect<RefsView, never, RepoHost> => notBuilt("903");

/** One folder at `at` (main when none), folders first, with its README. */
export const treeOf = (
  _project: CodeProject,
  _at: Option.Option<Rev>,
  _path: Option.Option<RepoPath>
): Effect.Effect<TreeListing, UnknownRevision | UnknownPath, RepoHost> =>
  notBuilt("903");

/** Every file path at `at`, up to the cap. */
export const pathsOf = (
  _project: CodeProject,
  _at: Option.Option<Rev>
): Effect.Effect<PathList, UnknownRevision, RepoHost> => notBuilt("903");

/** One file at `at`: its text, or that it is binary or too large. */
export const fileOf = (
  _project: CodeProject,
  _at: Option.Option<Rev>,
  _path: RepoPath
): Effect.Effect<FileView, UnknownRevision | UnknownPath, RepoHost> =>
  notBuilt("903");

/** A page of first-parent commits from `at`, each landing with its record. */
export const logOf = (
  _project: CodeProject,
  _input: {
    readonly at: Option.Option<Rev>;
    readonly path: Option.Option<RepoPath>;
    readonly from: number;
    readonly limit: number;
  }
): Effect.Effect<
  { readonly commits: readonly CommitView[]; readonly next?: number },
  UnknownRevision,
  RepoHost
> => notBuilt("903");

/** One commit and the files it changed against its first parent. */
export const commitOf = (
  _project: CodeProject,
  _sha: CommitSha
): Effect.Effect<CommitDiff, UnknownCommit, RepoHost> => notBuilt("903");

/** Why each line of a file at `at` is there. */
export const whyOf = (
  _project: CodeProject,
  _at: Option.Option<Rev>,
  _path: RepoPath
): Effect.Effect<WhyView, UnknownRevision | UnknownPath, RepoHost> =>
  notBuilt("912");
