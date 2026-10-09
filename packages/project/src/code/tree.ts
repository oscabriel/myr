/**
 * Folders of a commit: a tree's entries by its id (kept once read), the
 * entry at a path, walked one segment at a time, and one folder as a
 * reader lists it: folders first, then by name, each entry by its kind,
 * with its README by GitLab's precedence, any case.
 */
import { ObjectId, RepoHost, TreeEntry } from "@repo/artifacts/repo-host";
import type { RepoNotFound } from "@repo/artifacts/repo-host";
import type { CodeEntry, Rev, TreeListing } from "@repo/protocol/domain/code";
import { BlobSha, RepoPath } from "@repo/protocol/ids";
import type { CommitSha, RepoName } from "@repo/protocol/ids";
import { UnknownPath } from "@repo/protocol/refusal";
import type { UnknownRevision } from "@repo/protocol/refusal";
import { Array, Effect, Match, Option, Order, Schema } from "effect";

import type { CodeProject } from "../code.ts";
import { CodeCache } from "./cache.ts";
import { throughStore, TREE_VERSION } from "./history.ts";
import type { Kept } from "./history.ts";
import { commitAt, resolveRev } from "./revision.ts";

/**
 * How many commits a walk over history (a path's log, why each line is
 * there) has under way at once, in one ordered pass with no batch to wait
 * on. A live store answers each read in tens to hundreds of milliseconds,
 * and a path four folders deep chains five reads per commit, so one at a
 * time a 200-commit walk took a minute on dev-oscabriel and sixteen at
 * once in batches still 14-28 s. Forty-eight at once, at a few
 * hundred milliseconds each, stays under the store's 2,000 requests per
 * 10 s per repo for one viewer.
 */
export const READS_AT_ONCE = 48;

/** A tree's entries as the code store keeps them: names, modes and ids. */
const treeKept: Kept<readonly TreeEntry[]> = {
  kind: "tree",
  schema: Schema.Array(TreeEntry),
  version: TREE_VERSION,
};

/**
 * The entries of the tree `id`; a tree a commit or a tree names is always
 * there. Read through the isolate's cache, then the code store under
 * `<repo>/tree/v<TREE_VERSION>/<id>`, then the repo: a tree's id fixes its
 * entries, so a tree one view read is never read from the repo again by
 * any isolate. Every root tree a walk reads is shared by every other path's
 * walk over the same commits, so a repo's first walk pays for them once.
 */
export const entriesOf = (
  repo: RepoName,
  id: string
): Effect.Effect<readonly TreeEntry[], RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const cache = yield* CodeCache;

    return yield* cache.through(
      `${repo}:tree:${id}`,
      throughStore(
        treeKept,
        `${repo}/${treeKept.kind}/v${treeKept.version}/${id}`,
        RepoHost.use((host) => host.readTree(repo, ObjectId.make(id))).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.die(`${repo} has no tree ${id}`),
              onSome: Effect.succeed,
            })
          )
        )
      )
    );
  });

/** The segments of `path`; none when one is empty, `.` or `..`. */
export const segmentsOf = (path: string): Option.Option<readonly string[]> => {
  const segments = path.split("/");

  return segments.every(
    (segment) => segment !== "" && segment !== "." && segment !== ".."
  )
    ? Option.some(segments)
    : Option.none();
};

/** The entry at `path` under the tree `root`, walked one segment at a time. */
export const entryAt = (
  repo: RepoName,
  root: string,
  path: string
): Effect.Effect<Option.Option<TreeEntry>, RepoNotFound, RepoHost> =>
  Option.match(segmentsOf(path), {
    onNone: () => Effect.succeedNone,
    onSome: (segments) =>
      Effect.gen(function* () {
        let tree = root;
        let found: Option.Option<TreeEntry> = Option.none();

        for (const [at, segment] of segments.entries()) {
          if (at > 0) {
            if (Option.isNone(found) || found.value.type !== "tree") {
              return Option.none();
            }

            tree = found.value.sha;
          }

          const entries = yield* entriesOf(repo, tree);

          found = Array.findFirst(entries, ({ name }) => name === segment);
        }

        return found;
      }),
  });

/** What a reader sees an entry as: a gitlink is a submodule, mode 120000 a symlink. */
export const kindOf = (entry: TreeEntry): CodeEntry["type"] =>
  Match.value(entry).pipe(
    Match.when({ type: "tree" }, () => "tree" as const),
    Match.when({ type: "commit" }, () => "submodule" as const),
    Match.when({ mode: "120000" }, () => "symlink" as const),
    Match.orElse(() => "blob" as const)
  );

/** Folders first, then by name. */
const byKindThenName = Order.combine(
  Order.mapInput(Order.Boolean, (entry: CodeEntry) => entry.type !== "tree"),
  Order.mapInput(Order.String, (entry: CodeEntry) => entry.name)
);

/** GitLab's README precedence, lowercased. */
const README = [
  "readme.md",
  "readme.markdown",
  "readme.mdown",
  "readme",
  "readme.txt",
  "readme.rst",
];

const readmeOf = (entries: readonly CodeEntry[]) =>
  Array.findFirst(README, (name) =>
    Array.findFirst(
      entries,
      (entry) => entry.type === "blob" && entry.name.toLowerCase() === name
    )
  ).pipe(Option.map(({ path, sha }) => ({ path, sha: BlobSha.make(sha) })));

/** The tree `path` names at `commit`, or `UnknownPath`. */
export const folderAt = (
  repo: RepoName,
  commit: CommitSha,
  path: Option.Option<RepoPath>
): Effect.Effect<string, UnknownPath, RepoHost> =>
  Effect.gen(function* () {
    const found = yield* commitAt(repo, commit).pipe(
      Effect.flatMap(Effect.fromOption)
    );

    if (Option.isNone(path)) {
      return found.tree;
    }

    const entry = yield* entryAt(repo, found.tree, path.value);

    if (Option.isNone(entry) || entry.value.type !== "tree") {
      return yield* new UnknownPath({ commit, path: path.value });
    }

    return entry.value.sha;
  }).pipe(
    Effect.catchTags({
      NoSuchElementError: Effect.die,
      RepoNotFound: Effect.die,
    })
  );

/** One folder at `at`, folders first, with its README. */
export const listing = (
  project: CodeProject,
  at: Option.Option<Rev>,
  path: Option.Option<RepoPath>
): Effect.Effect<TreeListing, UnknownRevision | UnknownPath, RepoHost> =>
  Effect.gen(function* () {
    const commit = yield* resolveRev(project, at);
    const tree = yield* folderAt(project.repo, commit, path);

    const prefix = Option.match(path, {
      onNone: () => "",
      onSome: (folder) => `${folder}/`,
    });

    const read = yield* entriesOf(project.repo, tree).pipe(Effect.orDie);

    const entries = Array.sort(
      read.map((entry): CodeEntry => ({
        mode: entry.mode,
        name: entry.name,
        path: RepoPath.make(`${prefix}${entry.name}`),
        sha: entry.sha,
        type: kindOf(entry),
      })),
      byKindThenName
    );

    return {
      at: commit,
      entries,
      ...Option.match(path, {
        onNone: () => ({}),
        onSome: (folder) => ({ path: folder }),
      }),
      ...Option.match(readmeOf(entries), {
        onNone: () => ({}),
        onSome: (readme) => ({ readme }),
      }),
    };
  });
