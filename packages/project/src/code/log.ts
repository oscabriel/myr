/**
 * The first-parent log from a revision, a page at a time: each commit as a
 * reader sees it (subject, body, trailers, who and when), and `landing`
 * only where the project's record has one, so a trailer in an imported
 * commit never reads as a landing. With a path, only the commits whose
 * first-parent change touched it, scanning at most 200 commits a call;
 * `next` is where the scan stopped, so the next page resumes it.
 */
import { Revision, RepoHost } from "@repo/artifacts/repo-host";
import type {
  Commit,
  RepoNotFound,
  TreeEntry,
} from "@repo/artifacts/repo-host";
import { parseTrailers } from "@repo/git/trailers";
import type { CommitView, Rev } from "@repo/protocol/domain/code";
import type { LandingView } from "@repo/protocol/domain/landing";
import { TreeSha } from "@repo/protocol/ids";
import type { CommitSha, RepoName, RepoPath } from "@repo/protocol/ids";
import type { UnknownRevision } from "@repo/protocol/refusal";
import { DateTime, Effect, Equal, Option } from "effect";

import type { CodeProject } from "../code.ts";
import { CodeCache } from "./cache.ts";
import { commitAt, resolveRev } from "./revision.ts";
import { entryAt } from "./tree.ts";

/** The most commits one page holds. */
export const LOG_LIMIT = 100;

/** The most first-parent commits a path's log scans in one call. */
export const PATH_SCAN = 200;

/** A commit as a reader sees it, with its landing when it is one. */
export const commitView = (
  commit: Commit,
  landing: Option.Option<LandingView>
): CommitView => {
  const [subject = "", ...rest] = commit.message.split("\n");

  return {
    author: {
      at: DateTime.fromEpochSeconds(commit.authoredAt),
      email: commit.author.email,
      name: commit.author.name,
    },
    body: rest.join("\n").replace(/^\n+/u, ""),
    committer: {
      at: DateTime.fromEpochSeconds(commit.committedAt),
      email: commit.committer.email,
      name: commit.committer.name,
    },
    parents: commit.parents,
    sha: commit.sha,
    subject,
    trailers: parseTrailers(commit.message).map(({ key, value }) => ({
      key,
      value,
    })),
    tree: TreeSha.make(commit.tree),
    ...Option.match(landing, {
      onNone: () => ({}),
      onSome: (found) => ({ landing: found }),
    }),
  };
};

/** `commits` as a reader sees them, each landing from one batch of the project's record. */
export const commitViews = (
  project: CodeProject,
  commits: readonly Commit[]
): Effect.Effect<readonly CommitView[]> =>
  Effect.map(
    commits.length === 0
      ? Effect.succeed([])
      : project.landings(commits.map(({ sha }) => sha)),
    (landings) => {
      const bySha = new Map<string, LandingView>(
        landings.map((landing) => [landing.sha, landing])
      );

      return commits.map((commit) =>
        commitView(commit, Option.fromUndefinedOr(bySha.get(commit.sha)))
      );
    }
  );

/**
 * `count` first-parent commits from `sha`, the first `from` skipped: a
 * commit's history never changes, so the page is kept by its start.
 */
const pageOf = (
  repo: RepoName,
  sha: CommitSha,
  from: number,
  count: number
): Effect.Effect<readonly Commit[], RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const cache = yield* CodeCache;

    return yield* cache.through(
      `${repo}:log:${sha}:${from}:${count}`,
      RepoHost.use((host) =>
        host.log(repo, Revision.Commit({ sha }), count, from)
      )
    );
  });

/** What sits at `path` in `tree`: its id and mode, or nothing. */
const idAt = (repo: RepoName, tree: string, path: RepoPath) =>
  Effect.map(
    entryAt(repo, tree, path),
    Option.map(({ mode, sha }: TreeEntry) => `${mode} ${sha}`)
  );

/** A page of the log, and where the next starts when there is more. */
export interface LogPage {
  readonly commits: readonly CommitView[];
  readonly next?: number;
}

const pageWith = (
  commits: readonly CommitView[],
  next: Option.Option<number>
): LogPage =>
  Option.match(next, {
    onNone: () => ({ commits }),
    onSome: (at) => ({ commits, next: at }),
  });

/** A page of first-parent commits from `at`, each landing with its record. */
export const logPage = (
  project: CodeProject,
  input: {
    readonly at: Option.Option<Rev>;
    readonly path: Option.Option<RepoPath>;
    readonly from: number;
    readonly limit: number;
  }
): Effect.Effect<LogPage, UnknownRevision, RepoHost> =>
  Effect.gen(function* () {
    const sha = yield* resolveRev(project, input.at);
    const from = Math.max(0, Math.floor(input.from));
    const limit = Math.min(LOG_LIMIT, Math.max(1, Math.floor(input.limit)));
    const { repo } = project;

    if (Option.isNone(input.path)) {
      const read = yield* pageOf(repo, sha, from, limit + 1).pipe(Effect.orDie);
      const commits = yield* commitViews(project, read.slice(0, limit));

      return pageWith(
        commits,
        read.length > limit ? Option.some(from + limit) : Option.none()
      );
    }

    const path = input.path.value;

    // One past the scan, so the last scanned commit's parent is at hand
    // and whether history goes on is known.
    const scan = yield* pageOf(repo, sha, from, PATH_SCAN + 1).pipe(
      Effect.orDie
    );

    const scanned = scan.slice(0, PATH_SCAN);
    const touched: Commit[] = [];

    for (const [at, commit] of scanned.entries()) {
      const parent = Option.fromUndefinedOr(commit.parents[0]);
      const after = Option.fromUndefinedOr(scan[at + 1]);

      // The log is first parents, so the next commit in it is this one's
      // parent; only past the scan is the parent read on its own.
      const parentCommit = yield* Option.match(parent, {
        onNone: () => Effect.succeedNone,
        onSome: (first) =>
          Option.exists(after, ({ sha: next }) => next === first)
            ? Effect.succeed(after)
            : commitAt(repo, first),
      }).pipe(Effect.orDie);

      const parentTree = Option.map(parentCommit, ({ tree }) => tree);

      const now = yield* idAt(repo, commit.tree, path).pipe(Effect.orDie);

      const before = yield* Option.match(parentTree, {
        onNone: () => Effect.succeedNone,
        onSome: (tree) => idAt(repo, tree, path),
      }).pipe(Effect.orDie);

      if (!Equal.equals(now, before)) {
        touched.push(commit);
      }

      if (touched.length === limit) {
        const commits = yield* commitViews(project, touched);

        return pageWith(
          commits,
          at + 1 < scan.length ? Option.some(from + at + 1) : Option.none()
        );
      }
    }

    const commits = yield* commitViews(project, touched);

    return pageWith(
      commits,
      scan.length > PATH_SCAN ? Option.some(from + PATH_SCAN) : Option.none()
    );
  });
