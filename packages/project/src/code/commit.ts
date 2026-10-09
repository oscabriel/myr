/**
 * One commit and what it changed against its first parent (a root commit
 * against the empty tree), through `treeDiff` (`@repo/git/tree-diff`): each
 * file's status, both blob ids, whether it is binary, and its old and new
 * text. At most 300 files and 2 MiB of text in all: past 300 files every
 * file is a path only, and once the text runs past 2 MiB the files after
 * it are; either way the diff says it is `truncated`. The list of changes
 * is kept by the commit's id; the landing is asked for on every call.
 */
import { RepoHost } from "@repo/artifacts/repo-host";
import type { RepoNotFound, TreeEntry } from "@repo/artifacts/repo-host";
import { treeDiff } from "@repo/git/tree-diff";
import type { Change } from "@repo/git/tree-diff";
import type { ChangedFile, CommitDiff } from "@repo/protocol/domain/code";
import { BlobSha, TreeSha } from "@repo/protocol/ids";
import type { CommitSha, RepoName } from "@repo/protocol/ids";
import { UnknownCommit } from "@repo/protocol/refusal";
import { Array, Effect, Option, Order } from "effect";

import type { CodeProject } from "../code.ts";
import { CodeCache } from "./cache.ts";
import { contentsOf } from "./file.ts";
import type { Contents } from "./file.ts";
import { commitViews } from "./log.ts";
import { filesUnder, PATHS_CAP } from "./paths.ts";
import { commitAt } from "./revision.ts";
import { entriesOf, entryAt } from "./tree.ts";

/** The most files a commit's diff carries text for. */
export const DIFF_FILES = 300;

/** The most text a commit's diff carries in all: 2 MiB. */
export const DIFF_TEXT = 2 * 1024 * 1024;

/** A change, and whether each side is a submodule (whose id names no blob here). */
interface Changed extends Change {
  readonly links: { readonly before: boolean; readonly after: boolean };
}

const isLink = (entry: Option.Option<TreeEntry>) =>
  Option.exists(entry, ({ type }) => type === "commit");

/** Every file under a root commit's tree, each added. */
const rootChanges = (repo: RepoName, tree: string) =>
  Effect.map(filesUnder(repo, tree, PATHS_CAP), ({ files }) =>
    files.map(({ entry, path }): Changed => ({
      after: BlobSha.make(entry.sha),
      links: { after: entry.type === "commit", before: false },
      path,
      status: "added",
    }))
  );

/**
 * What changed from `base` to `head`, by `treeDiff` over this repo's trees
 * read through the cache (so the side lookups that follow read none again).
 */
const changesBetween = (repo: RepoName, base: string, head: string) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;

    const changes = yield* treeDiff(
      repo,
      TreeSha.make(base),
      TreeSha.make(head)
    ).pipe(
      Effect.provideService(
        RepoHost,
        RepoHost.of({
          ...host,
          readTree: (name, id) =>
            name === repo
              ? Effect.asSome(
                  Effect.provideService(entriesOf(repo, id), RepoHost, host)
                )
              : host.readTree(name, id),
        })
      )
    );

    return yield* Effect.forEach(
      changes,
      (change): Effect.Effect<Changed, RepoNotFound, RepoHost> =>
        Effect.map(
          Effect.all([
            entryAt(repo, base, change.path),
            entryAt(repo, head, change.path),
          ]),
          ([before, after]) => ({
            ...change,
            links: { after: isLink(after), before: isLink(before) },
          })
        ),
      { concurrency: 8 }
    );
  });

const byPath = Order.mapInput(Order.String, (change: Changed) => change.path);

/** A side's contents, unless it is a submodule or absent. */
const sideOf = (
  repo: RepoName,
  blob: BlobSha | undefined,
  link: boolean
): Effect.Effect<Option.Option<Contents>, RepoNotFound, RepoHost> =>
  blob === undefined || link ? Effect.succeedNone : contentsOf(repo, blob);

/** A change as a path, its status and its blob ids, with no text. */
const pathOnly = ({ after, before, path, status }: Changed): ChangedFile => {
  const file = { binary: false, path, status };

  if (before !== undefined && after !== undefined) {
    return { ...file, after, before };
  }

  if (before !== undefined) {
    return { ...file, before };
  }

  return after === undefined ? file : { ...file, after };
};

/** Each change with its text while the budget lasts, and whether any went without. */
const withText = (repo: RepoName, changes: readonly Changed[]) =>
  Effect.gen(function* () {
    if (changes.length > DIFF_FILES) {
      return { files: changes.map(pathOnly), truncated: true };
    }

    const files: ChangedFile[] = [];
    let budget = DIFF_TEXT;
    let truncated = false;

    for (const change of changes) {
      if (truncated) {
        files.push(pathOnly(change));
        continue;
      }

      const before = yield* sideOf(repo, change.before, change.links.before);
      const after = yield* sideOf(repo, change.after, change.links.after);
      const oldText = Option.flatMap(before, ({ text }) => text);
      const newText = Option.flatMap(after, ({ text }) => text);

      const size =
        Option.getOrElse(
          Option.map(oldText, (text) => text.length),
          () => 0
        ) +
        Option.getOrElse(
          Option.map(newText, (text) => text.length),
          () => 0
        );

      if (size > budget) {
        truncated = true;
        files.push(pathOnly(change));
        continue;
      }

      budget -= size;

      files.push({
        ...pathOnly(change),
        binary:
          Option.exists(before, ({ binary }) => binary) ||
          Option.exists(after, ({ binary }) => binary),
        ...Option.match(oldText, {
          onNone: () => ({}),
          onSome: (text) => ({ oldText: text }),
        }),
        ...Option.match(newText, {
          onNone: () => ({}),
          onSome: (text) => ({ newText: text }),
        }),
      });
    }

    return { files, truncated };
  });

/** One commit and the files it changed against its first parent. */
export const commitDiff = (
  project: CodeProject,
  sha: CommitSha
): Effect.Effect<CommitDiff, UnknownCommit, RepoHost> =>
  Effect.gen(function* () {
    const { repo } = project;
    const cache = yield* CodeCache;

    const commit = yield* commitAt(repo, sha).pipe(
      Effect.orDie,
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new UnknownCommit({ sha })),
          onSome: Effect.succeed,
        })
      )
    );

    const parent = yield* Option.match(
      Option.fromUndefinedOr(commit.parents[0]),
      {
        onNone: () => Effect.succeedNone,
        onSome: (first) => commitAt(repo, first),
      }
    ).pipe(Effect.orDie);

    const changes = yield* cache
      .through(
        `${repo}:changes:${sha}`,
        Option.match(parent, {
          onNone: () => rootChanges(repo, commit.tree),
          onSome: ({ tree }) => changesBetween(repo, tree, commit.tree),
        })
      )
      .pipe(Effect.orDie);

    const { files, truncated } = yield* withText(
      repo,
      Array.sort(changes, byPath)
    ).pipe(Effect.orDie);

    const [view] = yield* commitViews(project, [commit]);

    if (view === undefined) {
      return yield* Effect.die(`no view of ${sha}`);
    }

    return { commit: view, files, truncated };
  });
