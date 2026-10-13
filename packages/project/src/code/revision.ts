/**
 * `main` resolves from the project's record, never a ref; a tag name is
 * matched among the repo's tags, never joined into a ref path, so
 * `../heads/x` names nothing. A fork address (ADR 0043) is found among the
 * project's own listed forks, and its branch matched among that fork's
 * branches, so neither a layer's repo nor any repo the project does not list
 * is ever read.
 */
import { RepoHost } from "@repo/artifacts/repo-host";
import type { Commit, RepoNotFound } from "@repo/artifacts/repo-host";
import { forkAddressOf, ForkPoint } from "@repo/protocol/domain/code";
import type { ForkAddress, Rev } from "@repo/protocol/domain/code";
import { claimForkName, CommitSha, sameHandle } from "@repo/protocol/ids";
import type { RepoName } from "@repo/protocol/ids";
import { UnknownRevision } from "@repo/protocol/refusal";
import { Array, Effect, Option } from "effect";

import type { CodeProject } from "../code.ts";
import { CodeCache } from "./cache.ts";

const FULL_SHA = /^[0-9a-f]{40}$/u;

export const isFullSha = (rev: string) => FULL_SHA.test(rev);

const TAGS = "refs/tags/";

const BRANCHES = "refs/heads/";

const nameUnder = (prefix: string) => (ref: string) =>
  ref.startsWith(prefix)
    ? Option.some(ref.slice(prefix.length))
    : Option.none();

export const tagNameOf: (ref: string) => Option.Option<string> =
  nameUnder(TAGS);

const branchNameOf = nameUnder(BRANCHES);

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

/**
 * Where a revision resolved: the commit, and the repo that holds it. Only the
 * canonical repo's reads are kept in the code store; a fork's stay out of it.
 */
export interface Resolved {
  readonly canonical: boolean;
  readonly commit: CommitSha;
  readonly repo: RepoName;
}

/** The repo of a fork the project lists, only ever its claim fork's own name. */
const listedFork = (
  project: CodeProject,
  address: ForkAddress
): Effect.Effect<Option.Option<RepoName>> =>
  Effect.map(project.forks, (forks) =>
    Option.map(
      Array.findFirst(
        forks,
        (fork) =>
          fork.kind === "claim" &&
          fork.ask === address.ask &&
          sameHandle(fork.handle, address.handle) &&
          fork.repo ===
            claimForkName(project.project, address.ask, address.handle)
      ),
      ({ repo }) => repo
    )
  );

const pointIn = (
  repo: RepoName,
  address: ForkAddress
): Effect.Effect<Option.Option<CommitSha>, never, RepoHost> =>
  ForkPoint.$match(address.point, {
    Branch: ({ name }) =>
      RepoHost.use((host) => host.refs(repo)).pipe(
        Effect.map((refs) =>
          Option.map(
            Array.findFirst([...refs], ([ref]) =>
              Option.contains(branchNameOf(ref), name)
            ),
            ([, sha]) => sha
          )
        ),
        Effect.catchTag("RepoNotFound", () => Effect.succeedNone)
      ),
    Commit: ({ sha }) =>
      commitAt(repo, sha).pipe(
        Effect.map(Option.map((found) => found.sha)),
        Effect.catchTag("RepoNotFound", () => Effect.succeedNone)
      ),
  });

const forkAt = (
  project: CodeProject,
  address: ForkAddress
): Effect.Effect<Option.Option<Resolved>, never, RepoHost> =>
  Effect.flatMap(listedFork(project, address), (listed) =>
    Option.match(listed, {
      onNone: () => Effect.succeedNone,
      onSome: (repo) =>
        Effect.map(
          pointIn(repo, address),
          Option.map((commit): Resolved => ({ canonical: false, commit, repo }))
        ),
    })
  );

const tagAt = (
  project: CodeProject,
  rev: string
): Effect.Effect<Option.Option<CommitSha>, never, RepoHost> =>
  // No tag holds a `:`, which git refuses in a ref name.
  rev.includes(":")
    ? Effect.succeedNone
    : RepoHost.use((host) => host.tags(project.repo)).pipe(
        Effect.catchTag("RepoNotFound", () => Effect.succeed([])),
        Effect.map((tags) =>
          Option.map(
            Array.findFirst(tags, ({ name }) =>
              Option.contains(tagNameOf(name), rev)
            ),
            ({ sha }) => sha
          )
        )
      );

/** `main`, a full commit id, a tag by its exact name, then a fork address. */
export const resolveAt = (
  project: CodeProject,
  at: Option.Option<Rev>
): Effect.Effect<Resolved, UnknownRevision, RepoHost> => {
  const rev = Option.getOrElse(at, () => "main");
  const unknown = new UnknownRevision({ rev });

  const canonical = (commit: CommitSha): Resolved => ({
    canonical: true,
    commit,
    repo: project.repo,
  });

  if (rev === "main") {
    return Effect.flatMap(project.head, (landed) =>
      Option.match(landed, {
        onNone: () => Effect.fail(unknown),
        onSome: (sha) => Effect.succeed(canonical(sha)),
      })
    );
  }

  if (isFullSha(rev)) {
    const sha = CommitSha.make(rev);

    return commitAt(project.repo, sha).pipe(
      Effect.catchTag("RepoNotFound", () => Effect.succeedNone),
      Effect.flatMap((found) =>
        Option.isSome(found)
          ? Effect.succeed(canonical(sha))
          : Effect.fail(unknown)
      )
    );
  }

  return Effect.flatMap(tagAt(project, rev), (tag) => {
    if (Option.isSome(tag)) {
      return Effect.succeed(canonical(tag.value));
    }

    return Option.match(forkAddressOf(rev), {
      onNone: () => Effect.fail(unknown),
      onSome: (address) =>
        forkAt(project, address).pipe(
          Effect.flatMap(Effect.fromOption),
          Effect.mapError(() => unknown)
        ),
    });
  });
};

/**
 * The repo a commit is read in: a listed fork's when `at` is its address, the
 * canonical repo's otherwise.
 */
export const repoAt = (
  project: CodeProject,
  at: Option.Option<Rev>
): Effect.Effect<Omit<Resolved, "commit">, UnknownRevision> => {
  const address = Option.flatMap(at, forkAddressOf);

  if (Option.isNone(address)) {
    return Effect.succeed({ canonical: true, repo: project.repo });
  }

  return Effect.flatMap(listedFork(project, address.value), (listed) =>
    Option.match(listed, {
      onNone: () =>
        Effect.fail(
          new UnknownRevision({ rev: Option.getOrElse(at, () => "main") })
        ),
      onSome: (repo) => Effect.succeed({ canonical: false, repo }),
    })
  );
};
