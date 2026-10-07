import { CommitSha } from "@repo/protocol/ids";
import { Effect } from "effect";
import { init, writeBlob, writeCommit, writeTree } from "isomorphic-git";
import type { FsClient, TreeEntry } from "isomorphic-git";

/** Paths and their text, such as `[["src/a.ts", "v1"]]`. */
export type Files = readonly (readonly [path: string, content: string])[];

// Fixed, so the same files and parents always make the same commit id.
const signature = {
  email: "answerer@example.com",
  name: "Answerer",
  timestamp: 1_791_300_000,
  timezoneOffset: 0,
};

/**
 * A bare repo at `/client.git` in `fs` that tests build commits in and push
 * from. Its `source` is what `RepoHost.push` takes objects from.
 */
export const gitClient = (fs: FsClient) =>
  Effect.gen(function* () {
    const source = { fs, gitdir: "/client.git" };

    yield* Effect.promise(() =>
      init({ ...source, bare: true, defaultBranch: "main" })
    );

    const tree = (files: Files): Effect.Effect<string> =>
      Effect.gen(function* () {
        const entries: TreeEntry[] = [];
        const nested = new Map<string, [string, string][]>();

        for (const [path, content] of files) {
          const [head = path, ...rest] = path.split("/");

          if (rest.length === 0) {
            const oid = yield* Effect.promise(() =>
              writeBlob({ ...source, blob: new TextEncoder().encode(content) })
            );

            entries.push({ mode: "100644", oid, path: head, type: "blob" });
          } else {
            nested.set(head, [
              ...(nested.get(head) ?? []),
              [rest.join("/"), content],
            ]);
          }
        }

        for (const [path, inner] of nested) {
          const oid = yield* tree(inner);

          entries.push({ mode: "040000", oid, path, type: "tree" });
        }

        return yield* Effect.promise(() =>
          writeTree({ ...source, tree: entries })
        );
      });

    const commit = (
      message: string,
      files: Files,
      parents: readonly CommitSha[] = []
    ) =>
      Effect.gen(function* () {
        const root = yield* tree(files);

        const oid = yield* Effect.promise(() =>
          writeCommit({
            ...source,
            commit: {
              author: signature,
              committer: signature,
              message: `${message}\n`,
              parent: [...parents],
              tree: root,
            },
          })
        );

        return CommitSha.make(oid);
      });

    return { commit, source };
  });
