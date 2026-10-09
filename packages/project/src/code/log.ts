/**
 * The first-parent log from a revision, a page at a time: each commit as a
 * reader sees it (subject, body, trailers, who and when), and `landing`
 * only where the project's record has one, so a trailer in an imported
 * commit never reads as a landing. With a path, only the commits whose
 * first-parent change touched it, scanning at most 200 commits a call;
 * `next` is where the scan stopped, so the next page resumes it.
 *
 * A path's history from the scan's first commit is kept by immutable ids
 * (`history.ts`) under `<repo>/path-log/v<LOG_VERSION>/<commit>/<scan>/
 * <sha256(path)>`: the commits of the scan that changed the path, newest
 * first, and whether the scan reached the root; pages are cut from it.
 * Kept nowhere yet, it is the history kept at the nearest first-parent
 * ancestor within `INCREMENT_REACH` commits plus the commits between that
 * changed the path, cut to the scan; else each commit of the scan has its
 * entry looked up once (`READS_AT_ONCE` under way, in one ordered pass),
 * and neighbours compared.
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
import { Array, DateTime, Effect, Equal, Option } from "effect";

import type { CodeProject } from "../code.ts";
import { asOneView, CodeCache } from "./cache.ts";
import {
  INCREMENT_REACH,
  keyOf,
  pathLogKept,
  recall,
  throughHistory,
} from "./history.ts";
import type { StoredPathLog } from "./history.ts";
import { commitAt, resolveRev } from "./revision.ts";
import { entryAt, READS_AT_ONCE } from "./tree.ts";

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
export const pageOf = (
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
      ),
      { heavy: true }
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

/** What sits at `path` in each commit of `commits`, in order: one lookup each. */
const idsOf = (
  repo: RepoName,
  path: RepoPath,
  commits: readonly Commit[]
): Effect.Effect<readonly Option.Option<string>[], RepoNotFound, RepoHost> =>
  Effect.forEach(commits, ({ tree }) => idAt(repo, tree, path), {
    concurrency: READS_AT_ONCE,
  });

/**
 * The commits among the first `count` of `scan` that changed `path` from
 * their first parent, newest first. The log is first parents, so each
 * commit's parent is the next in `scan`; only past it (or should the log
 * ever say otherwise) is a parent read on its own.
 */
const changedIn = (
  repo: RepoName,
  path: RepoPath,
  scan: readonly Commit[],
  count: number
): Effect.Effect<readonly CommitSha[], RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const looked = scan.slice(0, count + 1);
    const ids = yield* idsOf(repo, path, looked);

    const changed = yield* Effect.forEach(
      looked.slice(0, count),
      (commit, at) =>
        Effect.gen(function* () {
          const parent = Option.fromUndefinedOr(commit.parents[0]);
          const after = looked[at + 1];

          const before = yield* Option.match(parent, {
            onNone: () => Effect.succeedNone,
            onSome: (first) =>
              after !== undefined && after.sha === first
                ? Effect.succeed(ids[at + 1] ?? Option.none())
                : commitAt(repo, first).pipe(
                    Effect.flatMap(
                      Option.match({
                        onNone: () => Effect.succeedNone,
                        onSome: ({ tree }) => idAt(repo, tree, path),
                      })
                    )
                  ),
          });

          return Equal.equals(ids[at] ?? Option.none(), before)
            ? Option.none()
            : Option.some(commit.sha);
        }),
      { concurrency: READS_AT_ONCE }
    );

    return Array.getSomes(changed);
  });

/** The path's history from `scan[0]`, kept at the nearest ancestor within reach. */
const nearestKept = (repo: RepoName, path: RepoPath, scan: readonly Commit[]) =>
  Effect.map(
    Effect.forEach(
      scan.slice(1, INCREMENT_REACH + 1),
      ({ sha }) =>
        Effect.flatMap(
          keyOf(pathLogKept, { commit: sha, path, repo, scan: PATH_SCAN }),
          (key) => recall(pathLogKept, key)
        ),
      { concurrency: INCREMENT_REACH }
    ),
    (found) =>
      Array.findFirst(found, (kept, at) =>
        Option.map(kept, (value) => ({ back: at + 1, kept: value }))
      )
  );

/** The path's history over `scan` (at most `PATH_SCAN` commits and the parent of its last). */
const historyOf = (
  repo: RepoName,
  path: RepoPath,
  scan: readonly Commit[]
): Effect.Effect<StoredPathLog, RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const scanned = scan.slice(0, PATH_SCAN);
    const reachedRoot = scan.length <= PATH_SCAN;
    const kept = yield* nearestKept(repo, path, scan);

    if (Option.isNone(kept)) {
      return {
        reachedRoot,
        shas: yield* changedIn(repo, path, scan, scanned.length),
      };
    }

    const { back } = kept.value;
    const inScan = new Set<string>(scanned.map(({ sha }) => sha));
    const between = yield* changedIn(repo, path, scan, back);

    return {
      reachedRoot,
      shas: [
        ...between,
        ...kept.value.kept.shas.filter((sha) => inScan.has(sha)),
      ],
    };
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

    const [start] = scan;

    if (start === undefined) {
      return pageWith([], Option.none());
    }

    const key = yield* keyOf(pathLogKept, {
      commit: start.sha,
      path,
      repo,
      scan: PATH_SCAN,
    });

    const { shas } = yield* throughHistory(
      pathLogKept,
      key,
      asOneView(historyOf(repo, path, scan))
    ).pipe(Effect.orDie);

    const at = new Map(scan.map((commit, index) => [commit.sha, index]));

    const touched = shas.slice(0, limit).flatMap((changed) => {
      const commit = scan[at.get(changed) ?? scan.length];

      return commit === undefined ? [] : [commit];
    });

    const commits = yield* commitViews(project, touched);
    const newest = touched.at(-1);
    const last = newest === undefined ? undefined : at.get(newest.sha);

    // A page that fills stops the scan at its last commit.
    if (touched.length === limit && last !== undefined) {
      return pageWith(
        commits,
        last + 1 < scan.length ? Option.some(from + last + 1) : Option.none()
      );
    }

    return pageWith(
      commits,
      scan.length > PATH_SCAN ? Option.some(from + PATH_SCAN) : Option.none()
    );
  });
