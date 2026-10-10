/**
 * One commit and what it changed against its first parent (a root commit
 * against the empty tree), through `treeDiff` (`@repo/git/tree-diff`): each
 * file's status, both blob ids, whether it is binary, and its old and new
 * text. At most 300 files and 2 MiB of text in all: past 300 files every
 * file is a path only, and once the text runs past 2 MiB the files after
 * it are; either way the diff says it is `truncated`.
 *
 * Each file's two sides are read `SIDES_AT_ONCE` files at a time, in path
 * order, and the budget is spent in that order, so the diff is the one a
 * read of one file after another gives. A tree entry carries no size, so
 * a side the budget drops cannot be known before it is read: once the
 * budget runs out no further window is read, and at most one window's
 * reads go unused.
 *
 * What a commit changed never changes, so the finished diff is kept in the
 * code store by its repo and id (`commitKey`), without its landing: the
 * landing is asked of the project's record on every call, so a later
 * landing shows at once and the store holds none (principle 7). A kept
 * value that no longer decodes is computed again; the list of changes is
 * also kept in the isolate's cache by the commit's id.
 */
import { RepoHost } from "@repo/artifacts/repo-host";
import type { RepoNotFound, TreeEntry } from "@repo/artifacts/repo-host";
import { treeDiff } from "@repo/git/tree-diff";
import type { Change } from "@repo/git/tree-diff";
import type { ChangedFile, CommitDiff } from "@repo/protocol/domain/code";
import { CommitDiff as CommitDiffSchema } from "@repo/protocol/domain/code";
import { BlobSha, TreeSha } from "@repo/protocol/ids";
import type { CommitSha, RepoName } from "@repo/protocol/ids";
import { UnknownCommit } from "@repo/protocol/refusal";
import { Array, Effect, Option, Order, Schema } from "effect";

import { CodeStore } from "../code-store.ts";
import type { CodeProject } from "../code.ts";
import { CodeCache } from "./cache.ts";
import { contentsOf } from "./file.ts";
import type { Contents } from "./file.ts";
import { commitView } from "./log.ts";
import { filesUnder, PATHS_CAP } from "./paths.ts";
import { commitAt } from "./revision.ts";
import { entriesOf, entryAt } from "./tree.ts";

/** The most files a commit's diff carries text for. */
export const DIFF_FILES = 300;

/** The most text a commit's diff carries in all: 2 MiB. */
export const DIFF_TEXT = 2 * 1024 * 1024;

/** The kept commit's version, in its key: it moves when what is kept changes. */
export const COMMIT_VERSION = 1;

/** Where a commit's diff is kept in the code store: by its repo and its id. */
export const commitKey = (repo: RepoName, sha: CommitSha) =>
  `${repo}/commit/v${COMMIT_VERSION}/${sha}`;

/** How many files' sides are read at once: the fan-out the changes are listed with. */
const SIDES_AT_ONCE = 8;

/** The longest list of changes the cache keeps. */
const KEPT_CHANGES = 1000;

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

/** Both sides of `change`: its old contents and its new, where it has them. */
const sidesOf = (repo: RepoName, change: Changed) =>
  Effect.all([
    sideOf(repo, change.before, change.links.before),
    sideOf(repo, change.after, change.links.after),
  ]);

/** The length of a side's text, or 0 when it has none. */
const lengthOf = (text: Option.Option<string>) =>
  Option.match(text, { onNone: () => 0, onSome: ({ length }) => length });

/**
 * Each change with its text while the budget lasts, and whether any went
 * without: the sides read a window of `SIDES_AT_ONCE` files at a time, the
 * budget spent in path order, and no window read once it ran out.
 */
const withText = (repo: RepoName, changes: readonly Changed[]) =>
  Effect.gen(function* () {
    if (changes.length > DIFF_FILES) {
      return { files: changes.map(pathOnly), truncated: true };
    }

    const files: ChangedFile[] = [];
    let budget = DIFF_TEXT;
    let truncated = false;

    for (const window of Array.chunksOf(changes, SIDES_AT_ONCE)) {
      if (truncated) {
        files.push(...window.map(pathOnly));
        continue;
      }

      const sides = yield* Effect.forEach(
        window,
        (change) => sidesOf(repo, change),
        { concurrency: SIDES_AT_ONCE }
      );

      for (const [index, change] of window.entries()) {
        const [before, after] = sides[index] ?? [Option.none(), Option.none()];

        if (truncated) {
          files.push(pathOnly(change));
          continue;
        }

        const oldText = Option.flatMap(before, ({ text }) => text);
        const newText = Option.flatMap(after, ({ text }) => text);
        const size = lengthOf(oldText) + lengthOf(newText);

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
    }

    return { files, truncated };
  });

/** A diff as the store keeps it: JSON, by the protocol's own schema. */
const Kept = Schema.fromJsonString(CommitDiffSchema);

const decodeKept = Schema.decodeUnknownOption(Kept);

const encodeKept = Schema.encodeEffect(Kept);

/** `diff` with its commit's landing, asked of the project's record now. */
const withLanding = (
  project: CodeProject,
  diff: CommitDiff
): Effect.Effect<CommitDiff> =>
  Effect.map(project.landings([diff.commit.sha]), (landings) =>
    Option.match(
      Array.findFirst(landings, ({ sha }) => sha === diff.commit.sha),
      {
        onNone: () => diff,
        onSome: (landing) => ({
          ...diff,
          commit: { ...diff.commit, landing },
        }),
      }
    )
  );

/** The diff kept for `sha` in the code store, if one is and it still decodes. */
const keptDiff = (repo: RepoName, sha: CommitSha) =>
  Effect.gen(function* () {
    const store = yield* CodeStore;
    const text = yield* store.get(commitKey(repo, sha));

    return Option.filter(
      Option.flatMap(text, decodeKept),
      ({ commit }) => commit.sha === sha
    );
  });

/** `diff`, which carries no landing, kept for `sha`; a store that fails keeps nothing. */
const keepDiff = (repo: RepoName, sha: CommitSha, diff: CommitDiff) =>
  Effect.gen(function* () {
    const store = yield* CodeStore;

    yield* encodeKept(diff).pipe(
      Effect.flatMap((text) => store.put(commitKey(repo, sha), text)),
      Effect.catch((error) =>
        Effect.logWarning(`${sha}'s diff was not kept`, error)
      )
    );
  });

/** The diff of `sha` against its first parent, computed, with no landing. */
const computedDiff = (
  repo: RepoName,
  sha: CommitSha
): Effect.Effect<CommitDiff, UnknownCommit, RepoHost> =>
  Effect.gen(function* () {
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
        }),
        // A longer list is listed again, over trees the cache keeps.
        { heavy: true, keep: (all) => all.length <= KEPT_CHANGES }
      )
      .pipe(Effect.orDie);

    const { files, truncated } = yield* withText(
      repo,
      Array.sort(changes, byPath)
    ).pipe(Effect.orDie);

    return { commit: commitView(commit, Option.none()), files, truncated };
  });

/** One commit and the files it changed against its first parent. */
export const commitDiff = (
  project: CodeProject,
  sha: CommitSha
): Effect.Effect<CommitDiff, UnknownCommit, RepoHost> =>
  Effect.gen(function* () {
    const { repo } = project;
    const kept = yield* keptDiff(repo, sha);

    if (Option.isSome(kept)) {
      return yield* withLanding(project, kept.value);
    }

    const diff = yield* computedDiff(repo, sha);

    yield* keepDiff(repo, sha, diff);

    return yield* withLanding(project, diff);
  });
