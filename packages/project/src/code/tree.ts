import { ObjectId, RepoHost } from "@repo/artifacts/repo-host";
import type { RepoNotFound, TreeEntry } from "@repo/artifacts/repo-host";
import type { CodeEntry, Rev, TreeListing } from "@repo/protocol/domain/code";
import { BlobSha, RepoPath } from "@repo/protocol/ids";
import type { CommitSha, RepoName } from "@repo/protocol/ids";
import { UnknownPath } from "@repo/protocol/refusal";
import type { UnknownRevision } from "@repo/protocol/refusal";
import { Array, Effect, Match, Option, Order } from "effect";

import type { CodeProject } from "../code.ts";
import { CodeCache } from "./cache.ts";
import { commitAt, resolveRev } from "./revision.ts";

/** Live store reads take 0.1-0.5 s and chain per path segment; 48 at once keeps a walk fast and under the store's 2,000 requests per 10 s per repo. */
export const READS_AT_ONCE = 48;

export const entriesOf = (
  repo: RepoName,
  id: string
): Effect.Effect<readonly TreeEntry[], RepoNotFound, RepoHost> =>
  Effect.gen(function* () {
    const cache = yield* CodeCache;

    return yield* cache.through(
      `${repo}:tree:${id}`,
      RepoHost.use((host) => host.readTree(repo, ObjectId.make(id))).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.die(`${repo} has no tree ${id}`),
            onSome: Effect.succeed,
          })
        )
      )
    );
  });

export const segmentsOf = (path: string): Option.Option<readonly string[]> => {
  const segments = path.split("/");

  return segments.every(
    (segment) => segment !== "" && segment !== "." && segment !== ".."
  )
    ? Option.some(segments)
    : Option.none();
};

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

export const kindOf = (entry: TreeEntry): CodeEntry["type"] =>
  Match.value(entry).pipe(
    Match.when({ type: "tree" }, () => "tree" as const),
    Match.when({ type: "commit" }, () => "submodule" as const),
    Match.when({ mode: "120000" }, () => "symlink" as const),
    Match.orElse(() => "blob" as const)
  );

const byKindThenName = Order.combine(
  Order.mapInput(Order.Boolean, (entry: CodeEntry) => entry.type !== "tree"),
  Order.mapInput(Order.String, (entry: CodeEntry) => entry.name)
);

const README = [
  "readme.md",
  "readme.markdown",
  "readme.mdown",
  "readme",
  "readme.txt",
  "readme.rst",
];

/** None when the target is absolute or climbs out of the repo. */
const linkTargetOf = (
  folder: string,
  target: string
): Option.Option<string> => {
  if (target.startsWith("/")) {
    return Option.none();
  }

  const resolved: string[] = folder === "" ? [] : folder.split("/");

  for (const segment of target.split("/")) {
    if (segment === "..") {
      if (resolved.pop() === undefined) {
        return Option.none();
      }
    } else if (segment !== "" && segment !== ".") {
      resolved.push(segment);
    }
  }

  return Option.liftPredicate(resolved.join("/"), (path) => path !== "");
};

const LINK_TARGET_MAX = 4096;

const linkTextOf = (repo: RepoName, link: string) =>
  Effect.gen(function* () {
    const cache = yield* CodeCache;

    return yield* cache.through(
      `${repo}:link:${link}`,
      RepoHost.use((host) => host.readBlob(repo, ObjectId.make(link))).pipe(
        Effect.map(
          Option.flatMap((bytes) =>
            bytes.length > LINK_TARGET_MAX
              ? Option.none()
              : Option.some(new TextDecoder().decode(bytes))
          )
        )
      )
    );
  });

/** One link followed, never a chain; a link's entry is a blob too, so its kind is asked, not its type. */
const linkedFile = (
  repo: RepoName,
  root: Effect.Effect<string, never, RepoHost>,
  folder: string,
  link: string
) =>
  Effect.gen(function* () {
    const path = Option.flatMap(
      yield* Effect.orDie(linkTextOf(repo, link)),
      (target) => linkTargetOf(folder, target)
    );

    if (Option.isNone(path)) {
      return Option.none();
    }

    const entry = yield* entryAt(repo, yield* root, path.value).pipe(
      Effect.orDie
    );

    return Option.flatMap(entry, (found) =>
      kindOf(found) === "blob"
        ? Option.some({
            path: RepoPath.make(path.value),
            sha: BlobSha.make(found.sha),
          })
        : Option.none()
    );
  });

const readmeOf = (
  repo: RepoName,
  root: Effect.Effect<string, never, RepoHost>,
  folder: string,
  entries: readonly CodeEntry[]
) =>
  Effect.gen(function* () {
    // Every entry by each name, so a dangling `README.md` link still lets
    // a `readme.md` file beside it be the README.
    const candidates = README.flatMap((name) =>
      entries.filter(
        (entry) =>
          (entry.type === "blob" || entry.type === "symlink") &&
          entry.name.toLowerCase() === name
      )
    );

    for (const found of candidates) {
      if (found.type === "blob") {
        return Option.some({ path: found.path, sha: BlobSha.make(found.sha) });
      }

      const linked = yield* linkedFile(repo, root, folder, found.sha);

      if (Option.isSome(linked)) {
        return linked;
      }
    }

    return Option.none();
  });

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

    const root = commitAt(project.repo, commit).pipe(
      Effect.flatMap(Effect.fromOption),
      Effect.map(({ tree: id }) => id),
      Effect.orDie
    );

    const readme = yield* readmeOf(
      project.repo,
      root,
      Option.getOrElse(path, () => ""),
      entries
    );

    return {
      at: commit,
      entries,
      ...Option.match(path, {
        onNone: () => ({}),
        onSome: (folder) => ({ path: folder }),
      }),
      ...Option.match(readme, {
        onNone: () => ({}),
        onSome: (found) => ({ readme: found }),
      }),
    };
  });
