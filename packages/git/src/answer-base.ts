import { RepoHost, Revision } from "@repo/artifacts/repo-host";
import type { RepoNotFound } from "@repo/artifacts/repo-host";
import type { CommitSha, LandedSha, RepoName } from "@repo/protocol/ids";
import { Effect, Option } from "effect";

/** How far back from `landed` main's landings are read for the base, in one log. */
const LANDINGS_READ = 256;

/** How many of the head's own commits are read before the walk gives up. */
const COMMITS_READ = 512;

const READS_AT_ONCE = 8;

export interface AnswerBaseInput {
  /** The repo `landed` and main's history live in. */
  readonly canonical: RepoName;
  /** The repo `head` lives in: the answer's fork, or the canonical repo itself. */
  readonly repo: RepoName;
  /** Where the answer's history left main's, as the claim's grant recorded it. */
  readonly base: CommitSha;
  readonly head: CommitSha;
  readonly landed: LandedSha;
}

/**
 * The base an answer is judged from: the newest of main's landings its head
 * contains, from `landed` back to the claim's `base`. An answer that merged
 * or rebased onto a main that moved under it is diffed from that main, so a
 * sibling's landed paths are not its own; one that stayed on its base is
 * diffed from the base, as before. The gateway, a submit and the local check
 * choose the base here, so the same change keeps the same patch id wherever
 * it is judged. A head that contains none of the landings, or whose history
 * is too long to walk, keeps the claim's base, as it did before.
 */
export const answerBase = (
  input: AnswerBaseInput
): Effect.Effect<CommitSha, RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    if (input.base === input.landed) {
      return input.base;
    }

    const host = yield* RepoHost;

    const chain = yield* host.log(
      input.canonical,
      Revision.Commit({ sha: input.landed }),
      LANDINGS_READ
    );

    // Newest first, cut before the claim's base: a chain the base is not on
    // within the limit offers nothing, so the base stands.
    const since = chain.findIndex((commit) => commit.sha === input.base);
    const landings = since === -1 ? [] : chain.slice(0, since);
    const rank = new Map(landings.map((commit, index) => [commit.sha, index]));

    if (landings.length === 0) {
      return input.base;
    }

    const seen = new Set<CommitSha>([input.head]);
    let frontier: readonly CommitSha[] = [input.head];
    let best = Option.none<number>();
    let reads = 0;

    // Breadth first over every parent, since a merge of main is a second
    // parent; a landing or the base ends its own branch of the walk.
    while (frontier.length > 0 && reads < COMMITS_READ) {
      const unread: CommitSha[] = [];

      for (const sha of frontier) {
        const found = rank.get(sha);

        if (found !== undefined) {
          best = Option.some(
            Option.match(best, {
              onNone: () => found,
              onSome: (held) => Math.min(held, found),
            })
          );
        } else if (sha !== input.base) {
          unread.push(sha);
        }
      }

      if (Option.contains(best, 0)) {
        return input.landed;
      }

      const read = yield* Effect.forEach(
        unread,
        (sha) => host.readCommit(input.repo, sha),
        { concurrency: READS_AT_ONCE }
      );

      reads += unread.length;

      frontier = read.flatMap((commit) =>
        Option.match(commit, {
          onNone: () => [],
          onSome: ({ parents }) =>
            parents.filter((parent) => {
              if (seen.has(parent)) {
                return false;
              }

              seen.add(parent);

              return true;
            }),
        })
      );
    }

    return Option.match(best, {
      onNone: () => input.base,
      onSome: (index) => landings[index]?.sha ?? input.base,
    });
  });
