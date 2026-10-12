/**
 * `main` resolves from the project's record, never a ref; a tag name is
 * matched among the repo's tags, never joined into a ref path, so
 * `../heads/x` names nothing.
 */
import { RepoHost } from "@repo/artifacts/repo-host";
import type { Commit, RepoNotFound } from "@repo/artifacts/repo-host";
import type { Rev } from "@repo/protocol/domain/code";
import { CommitSha } from "@repo/protocol/ids";
import type { RepoName } from "@repo/protocol/ids";
import { UnknownRevision } from "@repo/protocol/refusal";
import { Array, Effect, Option } from "effect";

import type { CodeProject } from "../code.ts";
import { CodeCache } from "./cache.ts";

const FULL_SHA = /^[0-9a-f]{40}$/u;

export const isFullSha = (rev: string) => FULL_SHA.test(rev);

const TAGS = "refs/tags/";

export const tagNameOf = (ref: string): Option.Option<string> =>
  ref.startsWith(TAGS) ? Option.some(ref.slice(TAGS.length)) : Option.none();

/** A miss is not kept: the commit may yet be pushed. */
export const commitAt = (
  repo: RepoName,
  sha: CommitSha
): Effect.Effect<Option.Option<Commit>, RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const cache = yield* CodeCache;

    return yield* cache
      .through(
        `${repo}:commit:${sha}`,
        RepoHost.use((host) => host.readCommit(repo, sha)).pipe(
          Effect.flatMap(Effect.fromOption)
        )
      )
      .pipe(
        Effect.asSome,
        Effect.catchTag("NoSuchElementError", () => Effect.succeedNone)
      );
  });

export const resolveRev = (
  project: CodeProject,
  at: Option.Option<Rev>
): Effect.Effect<CommitSha, UnknownRevision, RepoHost> => {
  const rev = Option.getOrElse(at, () => "main");
  const unknown = new UnknownRevision({ rev });

  if (rev === "main") {
    return Effect.flatMap(project.head, (landed) =>
      Option.match(landed, {
        onNone: () => Effect.fail(unknown),
        onSome: (sha) => Effect.succeed<CommitSha>(sha),
      })
    );
  }

  if (isFullSha(rev)) {
    const sha = CommitSha.make(rev);

    return commitAt(project.repo, sha).pipe(
      Effect.catchTag("RepoNotFound", () => Effect.succeedNone),
      Effect.flatMap((found) =>
        Option.isSome(found) ? Effect.succeed(sha) : Effect.fail(unknown)
      )
    );
  }

  return RepoHost.use((host) => host.tags(project.repo)).pipe(
    Effect.catchTag("RepoNotFound", () => Effect.succeed([])),
    Effect.flatMap((tags) =>
      Option.match(
        Array.findFirst(tags, ({ name }) =>
          Option.contains(tagNameOf(name), rev)
        ),
        {
          onNone: () => Effect.fail(unknown),
          onSome: ({ sha }) => Effect.succeed(sha),
        }
      )
    )
  );
};
