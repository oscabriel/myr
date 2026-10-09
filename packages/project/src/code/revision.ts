/**
 * A revision as a reader names it, resolved to the commit it means in the
 * project's canonical repo (ADR 0019): absent or `main` is main's landed
 * commit, from the project's record and never from a ref; 40 hex digits are
 * that commit, if the repo holds it; anything else is a tag's exact name,
 * found among the repo's tags and never joined into a ref path, so
 * `../heads/x` or a ref of the platform's own names nothing.
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

/** A full commit id: 40 lowercase hex digits. Short ids are not resolved. */
const FULL_SHA = /^[0-9a-f]{40}$/u;

/** Whether `rev` names a commit by its full id (and so never moves). */
export const isFullSha = (rev: string) => FULL_SHA.test(rev);

/** Where every tag's name starts. */
const TAGS = "refs/tags/";

/** A ref name's tag name, when it is a tag's. */
export const tagNameOf = (ref: string): Option.Option<string> =>
  ref.startsWith(TAGS) ? Option.some(ref.slice(TAGS.length)) : Option.none();

/**
 * The commit `sha` in `repo`, kept once found. A miss is not kept: the
 * commit may yet be pushed.
 */
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

/** The commit `at` names in the project's canonical repo. */
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
