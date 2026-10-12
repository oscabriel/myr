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

export const MOVER_SCAN = 50;

export type LandingsOf = (
  shas: readonly CommitSha[]
) => Effect.Effect<readonly LandingView[]>;

export interface Conflicted {
  readonly repo: RepoName;
  readonly base: CommitSha;
  readonly main: LandedSha;
  readonly conflicts: readonly RepoPath[];
}

const idAt = (repo: RepoName, commit: Commit | undefined, path: RepoPath) =>
  commit === undefined
    ? Effect.succeedNone
    : Effect.map(
        entryAt(repo, commit.tree, path),
        Option.map(({ mode, sha }) => `${mode} ${sha}`)
      );

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

const movedByOf = (path: RepoPath, landing: LandingView): MovedBy => {
  const ask = landing.ask ?? landing.opened;

  return ask === undefined
    ? { author: landing.author, landing: landing.sha, path }
    : { ask, author: landing.author, landing: landing.sha, path };
};

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
