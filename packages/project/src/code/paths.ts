/**
 * Every file of a commit: each blob, symlink and submodule path under its
 * root tree, up to 50,000 (a file tree's sidebar), kept by the root tree's
 * id. The walk reads at most eight trees at once and stops descending once
 * the cap is passed.
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
import { Array, Effect, Order, Ref, Semaphore } from "effect";

import type { CodeProject } from "../code.ts";
import { CodeCache } from "./cache.ts";
import { commitAt, resolveRev } from "./revision.ts";
import { entriesOf } from "./tree.ts";

/** The most paths a commit's list holds. */
export const PATHS_CAP = 50_000;

// Store calls under way at once, however wide or deep the tree.
const STORE_CALLS = 8;

/** One file under a root tree, with the entry that names it. */
export interface FileAt {
  readonly path: RepoPath;
  readonly entry: TreeEntry;
}

/**
 * Every file under the tree `root`, in path order; past `cap`, the walk
 * stops and says so.
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
    const calls = yield* Semaphore.make(STORE_CALLS);
    const seen = yield* Ref.make(0);

    const walk = (
      prefix: string,
      tree: string
    ): Effect.Effect<readonly FileAt[], RepoNotFound, RepoHost> =>
      Effect.gen(function* () {
        if ((yield* Ref.get(seen)) > cap) {
          return [];
        }

        const entries = yield* Semaphore.withPermit(
          calls,
          entriesOf(repo, tree)
        );

        const files = entries
          .filter(({ type }) => type !== "tree")
          .map((entry) => ({
            entry,
            path: RepoPath.make(`${prefix}${entry.name}`),
          }));

        yield* Ref.update(seen, (count) => count + files.length);

        const nested = yield* Effect.forEach(
          entries.filter(({ type }) => type === "tree"),
          (entry) => walk(`${prefix}${entry.name}/`, entry.sha),
          { concurrency: "unbounded" }
        );

        return [...files, ...nested.flat()];
      });

    const all = Array.sort(
      yield* walk("", root),
      Order.mapInput(Order.String, (file: FileAt) => file.path)
    );

    return {
      files: all.slice(0, cap),
      truncated: all.length > cap || (yield* Ref.get(seen)) > cap,
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
        filesUnder(project.repo, tree, PATHS_CAP)
      )
      .pipe(Effect.orDie);

    return { at: commit, paths: files.map(({ path }) => path), truncated };
  });
