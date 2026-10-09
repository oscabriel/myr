/**
 * Why each line of a file is there (spec W9-D9): a first-parent blame from
 * a revision. The walk takes at most `WHY_SCAN` first-parent commits from
 * the log and the path's blob at each (trees kept by id through
 * `CodeCache`), keeps the commits where the blob changed, then reads those
 * blobs newest first, one at a time, only until every line has its commit
 * (`@repo/git/blame`). Each commit a line points at comes back as a reader
 * sees it, and the landings among them come from the project's record in
 * one batch, so an imported commit never reads as a landing. Lines older
 * than the walk reached point at the commit it stopped at, named
 * `stoppedAt`. A binary file, or one past 1 MiB, has no ranges. The whole
 * view is kept by `(at, path)`: what a commit holds never changes.
 */
import { ObjectId, Revision, RepoHost } from "@repo/artifacts/repo-host";
import type { Commit, RepoNotFound } from "@repo/artifacts/repo-host";
import { blameFrom, isSettled, settle, traceBack } from "@repo/git/blame";
import type { Rev, WhyView } from "@repo/protocol/domain/code";
import { BlobSha } from "@repo/protocol/ids";
import type { CommitSha, RepoName, RepoPath } from "@repo/protocol/ids";
import { UnknownPath } from "@repo/protocol/refusal";
import type { UnknownRevision } from "@repo/protocol/refusal";
import { Array, Effect, Option } from "effect";

import type { CodeProject } from "../code.ts";
import { MAX_LANDINGS } from "../project.ts";
import { CodeCache } from "./cache.ts";
import { contentsOf, contentsOfBytes, unlessTooLarge } from "./file.ts";
import { commitViews } from "./log.ts";
import { commitAt, resolveRev } from "./revision.ts";
import { entryAt, READS_AT_ONCE } from "./tree.ts";

/** The most first-parent commits one view walks. */
export const WHY_SCAN = 200;

/** A version of the file: its blob, and the oldest commit that holds it. */
interface Version {
  readonly blob: BlobSha;
  readonly commit: Commit;
}

/** The file's blob at `path` in `commit`, if a file is there. */
const blobAt = (repo: RepoName, commit: Commit, path: RepoPath) =>
  Effect.map(
    entryAt(repo, commit.tree, path),
    Option.flatMap((entry) =>
      entry.type === "blob"
        ? Option.some(BlobSha.make(entry.sha))
        : Option.none()
    )
  );

/**
 * The file's versions newest first, from the commits of `log` (first
 * parents, newest first, starting with the blob `newest`), and whether the
 * walk stopped short of the file's first commit.
 */
const versionsOf = (
  repo: RepoName,
  path: RepoPath,
  log: readonly Commit[],
  newest: Version
): Effect.Effect<
  { readonly versions: readonly Version[]; readonly stopped: boolean },
  RepoNotFound,
  RepoHost
> =>
  Effect.gen(function* () {
    const versions: Version[] = [];
    let current = newest;

    // Each batch's blobs are read together, then walked in order.
    for (const batch of Array.chunksOf(log.slice(1), READS_AT_ONCE)) {
      const blobs = yield* Effect.forEach(
        batch,
        (commit) => blobAt(repo, commit, path),
        { concurrency: READS_AT_ONCE }
      );

      for (const [commit, blob] of Array.zip(batch, blobs)) {
        if (Option.contains(blob, current.blob)) {
          current = { blob: current.blob, commit };
        } else {
          versions.push(current);

          if (Option.isNone(blob)) {
            // The file was born in the commit after this one.
            return { stopped: false, versions };
          }

          current = { blob: blob.value, commit };
        }
      }
    }

    versions.push(current);

    return {
      stopped: current.commit.parents.length > 0,
      versions,
    };
  });

/**
 * An older version's text as the blame reads it, empty for a binary or too
 * large one. Read past the cache: old versions are seldom viewed, and
 * keeping them would push out the reads a reader comes back to.
 */
const textOf = (repo: RepoName, blob: BlobSha) =>
  unlessTooLarge(
    RepoHost.use((host) => host.readBlob(repo, ObjectId.make(blob))).pipe(
      Effect.map(Option.flatMap((bytes) => contentsOfBytes(bytes).text))
    ),
    Option.none
  ).pipe(Effect.map(Option.getOrElse(() => "")));

/** The landings among `shas`, asked for in batches the record answers. */
const landingsOf = (project: CodeProject, shas: readonly CommitSha[]) =>
  Effect.map(
    Effect.forEach(Array.chunksOf(shas, MAX_LANDINGS), project.landings),
    Array.flatten
  );

/** The view, read: `at` is a commit of the canonical repo. */
const read = (
  project: CodeProject,
  at: CommitSha,
  path: RepoPath,
  scan: number
): Effect.Effect<WhyView, UnknownPath | RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const { repo } = project;

    const head = yield* commitAt(repo, at).pipe(
      Effect.flatMap(Effect.fromOption),
      Effect.orDie
    );

    const blob = yield* blobAt(repo, head, path);

    if (Option.isNone(blob)) {
      return yield* new UnknownPath({ commit: at, path });
    }

    const none: WhyView = { at, commits: [], landings: [], path, ranges: [] };

    const contents = yield* contentsOf(repo, blob.value);

    if (Option.isNone(contents) || Option.isNone(contents.value.text)) {
      return none;
    }

    const log = yield* RepoHost.use((host) =>
      host.log(repo, Revision.Commit({ sha: at }), Math.max(1, scan))
    );

    const { stopped, versions } = yield* versionsOf(repo, path, log, {
      blob: blob.value,
      commit: head,
    });

    const [newest = { blob: blob.value, commit: head }, ...older] = versions;

    // The newest version is the file as read: its text is at hand.
    let tracing = blameFrom({
      sha: newest.commit.sha,
      text: contents.value.text.value,
    });

    for (const version of older) {
      if (isSettled(tracing)) {
        break;
      }

      tracing = traceBack(tracing, {
        sha: version.commit.sha,
        text: yield* textOf(repo, version.blob),
      });
    }

    const { ranges, reachedEnd } = settle(tracing);
    const named = new Set<string>(ranges.map(({ sha }) => sha));

    const commits = versions
      .map(({ commit }) => commit)
      .filter(({ sha }) => named.has(sha));

    const views = yield* commitViews(
      { ...project, landings: () => Effect.succeed([]) },
      commits
    );

    const landings = yield* landingsOf(
      project,
      commits.map(({ sha }) => sha)
    );

    const found: WhyView = { ...none, commits: views, landings, ranges };
    const last = versions.at(-1);

    // Lines the walk did not see brought: they point at where it stopped.
    return stopped && reachedEnd && last !== undefined
      ? { ...found, stoppedAt: last.commit.sha }
      : found;
  });

/** Why each line of `path` at `at` is there, walking at most `scan` commits. */
export const whyView = (
  project: CodeProject,
  at: Option.Option<Rev>,
  path: RepoPath,
  scan: number = WHY_SCAN
): Effect.Effect<WhyView, UnknownRevision | UnknownPath, RepoHost> =>
  Effect.gen(function* () {
    const commit = yield* resolveRev(project, at);
    const cache = yield* CodeCache;

    return yield* cache
      .through(
        `${project.repo}:why:${commit}:${scan}:${path}`,
        read(project, commit, path, scan),
        { heavy: true }
      )
      .pipe(Effect.catchTag("RepoNotFound", Effect.die));
  });
