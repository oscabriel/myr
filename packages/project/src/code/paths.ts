/**
 * Every file of a commit: each blob, symlink and submodule path under its
 * root tree, up to 50,000 (a file tree's sidebar), kept by the root tree's
 * id. The walk reads at most eight trees at once, one depth at a time, and
 * stops descending once the cap is passed.
 */
import type {
  RepoHost,
  RepoNotFound,
  TreeEntry,
} from "@repo/artifacts/repo-host";
import type { PathList, Rev } from "@repo/protocol/domain/code";
import { RepoPath } from "@repo/protocol/ids";
import type { RepoName } from "@repo/protocol/ids";
import type { UnknownRevision } from "@repo/protocol/refusal";
import type { Option } from "effect";
import { Array, Effect, Order } from "effect";

import type { CodeProject } from "../code.ts";
import { CodeCache } from "./cache.ts";
import { commitAt, resolveRev } from "./revision.ts";
import { entriesOf } from "./tree.ts";

/** The most paths a commit's list holds. */
export const PATHS_CAP = 50_000;

/** The longest path list the cache keeps: about 1 MB of paths. */
const KEPT_PATHS = 10_000;

// Store calls under way at once, however wide or deep the tree.
const STORE_CALLS = 8;

/** One file under a root tree, with the entry that names it. */
export interface FileAt {
  readonly path: RepoPath;
  readonly entry: TreeEntry;
}

/** A folder still to read: its path's prefix and its tree's id. */
interface Folder {
  readonly prefix: string;
  readonly tree: string;
}

/**
 * Every file under the tree `root`, in path order; past `cap`, the walk
 * stops and says so. It reads one depth at a time, so which folders it
 * reaches before it stops depends on the tree alone, never on which read
 * came back first: the same tree gives the same list (principle 8).
 */
export const filesUnder = (
  repo: RepoName,
  root: string,
  cap: number
): Effect.Effect<
  { readonly files: readonly FileAt[]; readonly truncated: boolean },
  RepoNotFound,
  RepoHost
> =>
  Effect.gen(function* () {
    const found: FileAt[] = [];
    let depth: readonly Folder[] = [{ prefix: "", tree: root }];

    while (depth.length > 0 && found.length <= cap) {
      const read = yield* Effect.forEach(
        depth,
        ({ prefix, tree }) =>
          Effect.map(entriesOf(repo, tree), (entries) => ({ entries, prefix })),
        { concurrency: STORE_CALLS }
      );

      const deeper: Folder[] = [];

      for (const { entries, prefix } of read) {
        for (const entry of entries) {
          if (entry.type === "tree") {
            deeper.push({ prefix: `${prefix}${entry.name}/`, tree: entry.sha });
          } else {
            found.push({
              entry,
              path: RepoPath.make(`${prefix}${entry.name}`),
            });
          }
        }
      }

      depth = deeper;
    }

    const all = Array.sort(
      found,
      Order.mapInput(Order.String, (file: FileAt) => file.path)
    );

    return {
      files: all.slice(0, cap),
      truncated: all.length > cap || depth.length > 0,
    };
  });

/** Every file path at `at`, up to the cap. */
export const pathList = (
  project: CodeProject,
  at: Option.Option<Rev>
): Effect.Effect<PathList, UnknownRevision, RepoHost> =>
  Effect.gen(function* () {
    const commit = yield* resolveRev(project, at);
    const cache = yield* CodeCache;

    const { tree } = yield* commitAt(project.repo, commit).pipe(
      Effect.flatMap(Effect.fromOption),
      Effect.orDie
    );

    const { files, truncated } = yield* cache
      .through(
        `${project.repo}:paths:${tree}`,
        filesUnder(project.repo, tree, PATHS_CAP),
        // A longer list is walked again, over trees the cache keeps.
        { heavy: true, keep: (list) => list.files.length <= KEPT_PATHS }
      )
      .pipe(Effect.orDie);

    return { at: commit, paths: files.map(({ path }) => path), truncated };
  });
