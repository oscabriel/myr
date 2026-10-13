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

export interface CodeProject {
  readonly project: ProjectName;
  /** The canonical repo: never a fork's or a layer's. A read reaches a fork only by an address `forks` lists. */
  readonly repo: RepoName;
  readonly head: Effect.Effect<Option.Option<LandedSha>>;
  /** The landings among `shas`, so a forged trailer never reads as one. */
  readonly landings: (
    shas: readonly CommitSha[]
  ) => Effect.Effect<readonly LandingView[]>;
  readonly forks: Effect.Effect<readonly ForkRef[]>;
}

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

export const refsOf = (
  project: CodeProject
): Effect.Effect<RefsView, never, RepoHost> => refsView(project);

export const treeOf = (
  project: CodeProject,
  at: Option.Option<Rev>,
  path: Option.Option<RepoPath>
): Effect.Effect<TreeListing, UnknownRevision | UnknownPath, RepoHost> =>
  listing(project, at, path);

export const pathsOf = (
  project: CodeProject,
  at: Option.Option<Rev>
): Effect.Effect<PathList, UnknownRevision, RepoHost> => pathList(project, at);

export const fileOf = (
  project: CodeProject,
  at: Option.Option<Rev>,
  path: RepoPath
): Effect.Effect<FileView, UnknownRevision | UnknownPath, RepoHost> =>
  fileView(project, at, path);

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

/** `at` names the fork to read the commit in; the canonical repo when absent. */
export const commitOf = (
  project: CodeProject,
  sha: CommitSha,
  at: Option.Option<Rev> = Option.none()
): Effect.Effect<CommitDiff, UnknownCommit | UnknownRevision, RepoHost> =>
  commitDiff(project, sha, at);

export const whyOf = (
  project: CodeProject,
  at: Option.Option<Rev>,
  path: RepoPath
): Effect.Effect<WhyView, UnknownRevision | UnknownPath, RepoHost> =>
  whyView(project, at, path);
