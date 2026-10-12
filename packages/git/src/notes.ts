import { ObjectId, RefName, RepoHost } from "@repo/artifacts/repo-host";
import type {
  PushSource,
  RepoNotFound,
  TreeEntry,
} from "@repo/artifacts/repo-host";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { Brand } from "@repo/brand";
import { Verdict } from "@repo/protocol/domain/answer";
import { CommitSha } from "@repo/protocol/ids";
import type { RepoName } from "@repo/protocol/ids";
import { DateTime, Effect, Option, Schema } from "effect";

import { committerLine } from "./trailers.ts";

export const notesRef = RefName.make(`refs/notes/${Brand.slug}`);

export interface NoteInput {
  readonly repo: RepoName;
  readonly notesParent: Option.Option<CommitSha>;
  readonly target: CommitSha;
  readonly verdict: Verdict;
  readonly now: DateTime.Utc;
}

export interface ScratchSource extends PushSource {
  readonly fs: MemoryFs;
}

type MemoryFs = ReturnType<typeof memoryFs>;

const encoder = new TextEncoder();

const concat = (parts: readonly Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let at = 0;

  for (const part of parts) {
    all.set(part, at);
    at += part.byteLength;
  }

  return all;
};

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const bytesOfHex = (id: string) =>
  Uint8Array.from(id.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));

const deflate = (bytes: Uint8Array) =>
  Effect.promise(() =>
    new Response(
      // A copy on its own `ArrayBuffer`: Node's `Blob` types refuse a view
      // that may sit on a `SharedArrayBuffer`, as `@repo/project` sees them.
      new Blob([Uint8Array.from(bytes)])
        .stream()
        .pipeThrough(new CompressionStream("deflate"))
    ).arrayBuffer()
  ).pipe(Effect.map((buffer) => new Uint8Array(buffer)));

const sortKey = (entry: TreeEntry) =>
  encoder.encode(entry.type === "tree" ? `${entry.name}/` : entry.name);

// git sorts a tree's entries by name, a subtree's name as if it ended in "/".
const treeOrder = (one: TreeEntry, other: TreeEntry) => {
  const left = sortKey(one);
  const right = sortKey(other);

  for (let at = 0; at < Math.min(left.length, right.length); at += 1) {
    const diff = (left[at] ?? 0) - (right[at] ?? 0);

    if (diff !== 0) {
      return diff;
    }
  }

  return left.length - right.length;
};

// A tree object spells a subtree's mode without its leading zero.
const modeOf = (entry: TreeEntry) => entry.mode.replace(/^0/u, "");

const treeBytes = (entries: readonly TreeEntry[]) =>
  concat(
    entries
      .toSorted(treeOrder)
      .flatMap((entry) => [
        encoder.encode(`${modeOf(entry)} ${entry.name}\0`),
        bytesOfHex(entry.sha),
      ])
  );

const signature = (now: DateTime.Utc) =>
  `${committerLine.name} <${committerLine.email}> ${Math.floor(DateTime.toEpochMillis(now) / 1000)} +0000`;

const commitBytes = (input: {
  readonly tree: string;
  readonly parents: readonly CommitSha[];
  readonly now: DateTime.Utc;
  readonly message: string;
}) =>
  encoder.encode(
    [
      `tree ${input.tree}`,
      ...input.parents.map((parent) => `parent ${parent}`),
      `author ${signature(input.now)}`,
      `committer ${signature(input.now)}`,
      "",
      input.message,
    ].join("\n")
  );

const scratch = () =>
  Effect.gen(function* () {
    const fs = memoryFs();
    const gitdir = "/notes.git";
    const made = new Set<string>();

    const mkdir = (path: string) =>
      made.has(path)
        ? Effect.void
        : Effect.promise(() => fs.promises.mkdir(path)).pipe(
            Effect.tap(() => Effect.sync(() => made.add(path)))
          );

    const write = (path: string, data: string | Uint8Array) =>
      Effect.promise(() => fs.promises.writeFile(path, data));

    yield* Effect.forEach(
      ["", "/objects", "/refs", "/refs/heads", "/refs/notes", "/refs/tags"],
      (dir) => mkdir(`${gitdir}${dir}`)
    );
    yield* write(`${gitdir}/HEAD`, "ref: refs/heads/main\n");
    yield* write(
      `${gitdir}/config`,
      "[core]\n\trepositoryformatversion = 0\n\tbare = true\n"
    );

    const object = (kind: "blob" | "tree" | "commit", content: Uint8Array) =>
      Effect.gen(function* () {
        const raw = concat([
          encoder.encode(`${kind} ${content.byteLength}\0`),
          content,
        ]);

        const id = hex(
          yield* Effect.promise(() => crypto.subtle.digest("SHA-1", raw))
        );

        const dir = `${gitdir}/objects/${id.slice(0, 2)}`;

        yield* mkdir(dir);
        yield* write(`${dir}/${id.slice(2)}`, yield* deflate(raw));

        return id;
      });

    return {
      object,
      ref: (ref: RefName, sha: CommitSha) =>
        write(`${gitdir}/${ref}`, `${sha}\n`),
      source: { fs, gitdir } satisfies ScratchSource,
    };
  });

const notesAt = (repo: RepoName, parent: Option.Option<CommitSha>) =>
  Option.match(parent, {
    onNone: () => Effect.succeed<readonly TreeEntry[]>([]),
    onSome: (sha) =>
      Effect.gen(function* () {
        const host = yield* RepoHost;
        const commit = yield* host.readCommit(repo, sha);

        if (Option.isNone(commit)) {
          return yield* Effect.die(`${repo} has no notes commit ${sha}`);
        }

        const tree = yield* host.readTree(repo, commit.value.tree);

        if (Option.isNone(tree)) {
          return yield* Effect.die(`${repo} has no tree ${commit.value.tree}`);
        }

        return tree.value;
      }),
  });

const encodeVerdict = Schema.encodeEffect(Schema.fromJsonString(Verdict));

/**
 * git's own notes layout: a fanout-free tree with one blob per annotated
 * commit, named by its SHA. The new objects sit in a scratch git directory in
 * memory, which `RepoHost.push` takes them from; the earlier notes' objects
 * are referenced by id and are already in `repo`.
 */
export const noteCommit = (
  input: NoteInput
): Effect.Effect<
  { readonly source: ScratchSource; readonly commit: CommitSha },
  RepoNotFound,
  RepoHost
> =>
  Effect.gen(function* () {
    const earlier = yield* notesAt(input.repo, input.notesParent);
    const json = yield* encodeVerdict(input.verdict).pipe(Effect.orDie);
    const repo = yield* scratch();
    const blob = yield* repo.object("blob", encoder.encode(`${json}\n`));

    const tree = yield* repo.object(
      "tree",
      treeBytes([
        ...earlier.filter(({ name }) => name !== input.target),
        {
          mode: "100644",
          name: input.target,
          sha: ObjectId.make(blob),
          type: "blob",
        },
      ])
    );

    const commit = CommitSha.make(
      yield* repo.object(
        "commit",
        commitBytes({
          message: `Verdict on ${input.target}\n`,
          now: input.now,
          parents: Option.toArray(input.notesParent),
          tree,
        })
      )
    );

    yield* repo.ref(notesRef, commit);

    return { commit, source: repo.source };
  });
