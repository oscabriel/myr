import { RepoHost } from "@repo/artifacts/repo-host";
import type { RepoNotFound, TreeEntry } from "@repo/artifacts/repo-host";
import { treeDiff } from "@repo/git/tree-diff";
import type { Change } from "@repo/git/tree-diff";
import { CommitDiff } from "@repo/protocol/domain/code";
import type { ChangedFile } from "@repo/protocol/domain/code";
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

export const DIFF_FILES = 300;

export const DIFF_TEXT = 2 * 1024 * 1024;

/** Bump when what is kept changes. */
export const COMMIT_VERSION = 1;

export const commitKey = (repo: RepoName, sha: CommitSha) =>
  `${repo}/commit/v${COMMIT_VERSION}/${sha}`;

const SIDES_AT_ONCE = 8;

const KEPT_CHANGES = 1000;

/** Whether each side is a submodule, whose id names no blob here. */
interface Changed extends Change {
  readonly links: { readonly before: boolean; readonly after: boolean };
}

const isLink = (entry: Option.Option<TreeEntry>) =>
  Option.exists(entry, ({ type }) => type === "commit");

const rootChanges = (repo: RepoName, tree: string) =>
  Effect.map(filesUnder(repo, tree, PATHS_CAP), ({ files }) =>
    files.map(({ entry, path }): Changed => ({
      after: BlobSha.make(entry.sha),
      links: { after: entry.type === "commit", before: false },
      path,
      status: "added",
    }))
  );

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

const sideOf = (
  repo: RepoName,
  blob: BlobSha | undefined,
  link: boolean
): Effect.Effect<Option.Option<Contents>, RepoNotFound, RepoHost> =>
  blob === undefined || link ? Effect.succeedNone : contentsOf(repo, blob);

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

const sidesOf = (repo: RepoName, change: Changed) =>
  Effect.all([
    sideOf(repo, change.before, change.links.before),
    sideOf(repo, change.after, change.links.after),
  ]);

const lengthOf = (text: Option.Option<string>) =>
  Option.match(text, { onNone: () => 0, onSome: ({ length }) => length });

/** The budget is spent in path order, and no window is read once it runs out. */
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

const Kept = Schema.fromJsonString(CommitDiff);

const decodeKept = Schema.decodeUnknownOption(Kept);

const encodeKept = Schema.encodeEffect(Kept);

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

const keptDiff = (repo: RepoName, sha: CommitSha) =>
  Effect.gen(function* () {
    const store = yield* CodeStore;
    const text = yield* store.get(commitKey(repo, sha));

    return Option.filter(
      Option.flatMap(text, decodeKept),
      ({ commit }) => commit.sha === sha
    );
  });

/** Kept without its landing, which is asked of the record on every call. */
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
        { heavy: true, keep: (all) => all.length <= KEPT_CHANGES }
      )
      .pipe(Effect.orDie);

    const { files, truncated } = yield* withText(
      repo,
      Array.sort(changes, byPath)
    ).pipe(Effect.orDie);

    return { commit: commitView(commit, Option.none()), files, truncated };
  });

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
