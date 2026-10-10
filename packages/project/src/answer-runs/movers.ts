/**
 * Who moved the paths a merge conflicts in. A three-way merge conflicts in
 * a path only where main changed it since the answer's base, so for each
 * path the walk finds the newest commit on main's first-parent line since
 * that base that changed it, and names it only when the project's record
 * holds it as a landing (a trailer never reads as one). The walk reads the
 * canonical repo through `RepoHost` (`code/tree.ts`'s lookups, shared as
 * one view), stops at the base or after `MOVER_SCAN` commits, and never
 * fails the merge: what it cannot read, it leaves out.
 */
import { RepoHost, Revision } from "@repo/artifacts/repo-host";
import type { Commit, RepoNotFound } from "@repo/artifacts/repo-host";
import type { LandingView } from "@repo/protocol/domain/landing";
import type {
  CommitSha,
  LandedSha,
  RepoName,
  RepoPath,
} from "@repo/protocol/ids";
import type { MovedBy } from "@repo/protocol/refusal";
import { Array, Cause, Effect, Equal, Option } from "effect";

import { asOneView } from "../code/cache.ts";
import { entryAt, READS_AT_ONCE } from "../code/tree.ts";

/** The most first-parent commits back from main a walk reads. */
export const MOVER_SCAN = 50;

/** The landings among `shas`, as the project's record holds them. */
export type LandingsOf = (
  shas: readonly CommitSha[]
) => Effect.Effect<readonly LandingView[]>;

/** What a merge conflicted in: the repo, the answer's base, main, and the paths. */
export interface Conflicted {
  readonly repo: RepoName;
  readonly base: CommitSha;
  readonly main: LandedSha;
  readonly conflicts: readonly RepoPath[];
}

/** What sits at `path` in `commit`: its mode and id, or nothing. */
const idAt = (repo: RepoName, commit: Commit | undefined, path: RepoPath) =>
  commit === undefined
    ? Effect.succeedNone
    : Effect.map(
        entryAt(repo, commit.tree, path),
        Option.map(({ mode, sha }) => `${mode} ${sha}`)
      );

/**
 * The newest of the first `since` commits of `scan` that changed `path`
 * from the commit after it, its first parent.
 */
const moverOf = (
  repo: RepoName,
  scan: readonly Commit[],
  since: number,
  path: RepoPath
): Effect.Effect<Option.Option<CommitSha>, RepoNotFound, RepoHost> =>
  Effect.map(
    Effect.forEach(
      Array.makeBy(since + 1, (at) => scan[at]),
      (commit) => idAt(repo, commit, path),
      { concurrency: READS_AT_ONCE }
    ),
    (ids) =>
      Array.findFirst(scan.slice(0, since), (commit, at) =>
        Equal.equals(ids[at], ids[at + 1])
          ? Option.none()
          : Option.some(commit.sha)
      )
  );

/** Each conflicting path's newest change since the base, where one is found. */
const moversOf = (input: Conflicted) =>
  asOneView(
    Effect.gen(function* () {
      const scan = yield* RepoHost.use((host) =>
        host.log(
          input.repo,
          Revision.Commit({ sha: input.main }),
          MOVER_SCAN + 1
        )
      );

      const based = scan.findIndex(({ sha }) => sha === input.base);
      const since = based === -1 ? Math.min(scan.length, MOVER_SCAN) : based;

      const found = yield* Effect.forEach(
        input.conflicts,
        (path) =>
          Effect.map(moverOf(input.repo, scan, since, path), (commit) =>
            Option.map(commit, (sha) => ({ path, sha }))
          ),
        { concurrency: READS_AT_ONCE }
      );

      return Array.getSomes(found);
    })
  );

/** A path's mover as the refusal names it, from its landing. */
const movedByOf = (path: RepoPath, landing: LandingView): MovedBy => {
  const ask = landing.ask ?? landing.opened;

  return ask === undefined
    ? { author: landing.author, landing: landing.sha, path }
    : { ask, author: landing.author, landing: landing.sha, path };
};

/**
 * Who last moved each path `input` conflicts in, by its landing, in the
 * order of `input.conflicts`. None when no conflicting path's change is a
 * landing the record holds, or when the walk could not read the repo.
 */
export const movedBy = (
  input: Conflicted,
  landings: LandingsOf
): Effect.Effect<readonly MovedBy[], never, RepoHost> =>
  Effect.gen(function* () {
    if (input.conflicts.length === 0) {
      return [];
    }

    const movers = yield* moversOf(input);

    if (movers.length === 0) {
      return [];
    }

    const bySha = new Map<string, LandingView>(
      (yield* landings(Array.dedupe(movers.map(({ sha }) => sha)))).map(
        (landing) => [landing.sha, landing]
      )
    );

    return movers.flatMap(({ path, sha }) => {
      const landing = bySha.get(sha);

      return landing === undefined ? [] : [movedByOf(path, landing)];
    });
  }).pipe(
    // Who moved a path is a courtesy on the refusal, never a reason to
    // block it: an unreadable repo leaves it out.
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.as(
            Effect.logWarning(
              "who moved a merge's conflicting paths was not found",
              cause
            ),
            []
          )
    )
  );
