/**
 * Git for the dev world: commits written the way git writes them, so the
 * memory repo host takes them by a push like any other, and files read back
 * through `RepoHost`.
 *
 * The world writes three kinds of commit: each example project's first
 * push, an answerer's commit on their claim's fork, and what the dev Lander
 * composes and lands. Each is written whole, every blob and tree of its
 * files, as loose objects in a scratch git directory in memory; a push
 * copies only what the repo lacks. Text files only: the examples hold
 * nothing else.
 */
import { ObjectId, RepoHost } from "@repo/artifacts/repo-host";
import type { PushSource, TreeEntry } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { BlobSha, CommitSha } from "@repo/protocol/ids";
import type { Handle, RepoName } from "@repo/protocol/ids";
import { Array, DateTime, Effect, Option, Predicate } from "effect";

/** A tree's files, by path, as text: what the world writes. */
export type Files = ReadonlyMap<string, string>;

/** A file as a commit holds it: its blob's id, and its text. */
export interface Held {
  readonly blob: BlobSha;
  readonly text: string;
}

/** A commit's files, by path, as read back. */
export type Snapshot = ReadonlyMap<string, Held>;

/** The name and email an author or committer line carries. */
export interface Identity {
  readonly email: string;
  readonly name: string;
}

/** The platform, which commits every landing. */
export const platformIdentity: Identity = {
  email: `platform@${Brand.domain}`,
  name: Brand.name,
};

/** A person, as the author of their own commits and of their landings. */
export const personIdentity = (handle: Handle): Identity => ({
  email: `${handle}@users.${Brand.domain}`,
  name: handle,
});

/** A snapshot's text alone. */
export const textOf = (snapshot: Snapshot): Files =>
  new Map([...snapshot].map(([path, { text }]) => [path, text]));

/** `files` with `changed` written over them. */
export const overlay = (
  files: Files,
  changed: Iterable<readonly [string, string]>
): Files => new Map([...files, ...changed]);

// --------------------------------------------------------------- objects

const encoder = new TextEncoder();

const decoder = new TextDecoder();

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

/** git's zlib stream, as a loose object holds it. */
const deflate = (bytes: Uint8Array) =>
  Effect.promise(() =>
    new Response(
      new Blob([Uint8Array.from(bytes)])
        .stream()
        .pipeThrough(new CompressionStream("deflate"))
    ).arrayBuffer()
  ).pipe(Effect.map((buffer) => new Uint8Array(buffer)));

/** An object's header and content, and its id: the SHA-1 of both. */
const framed = (kind: "blob" | "tree" | "commit", content: Uint8Array) => {
  const raw = concat([
    encoder.encode(`${kind} ${content.byteLength}\0`),
    content,
  ]);

  return Effect.map(
    Effect.promise(() => crypto.subtle.digest("SHA-1", raw)),
    (digest) => ({ id: hex(digest), raw })
  );
};

/** The id git gives a blob of `text`. */
export const blobIdOf = (text: string) =>
  Effect.map(framed("blob", encoder.encode(text)), ({ id }) =>
    BlobSha.make(id)
  );

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

const treeBytes = (entries: readonly TreeEntry[]) =>
  concat(
    entries.toSorted(treeOrder).flatMap((entry) => [
      // A tree object spells a subtree's mode without its leading zero.
      encoder.encode(`${entry.mode.replace(/^0/u, "")} ${entry.name}\0`),
      bytesOfHex(entry.sha),
    ])
  );

/**
 * A commit message as git keeps it: no carriage returns, no blank lines
 * first, and one newline last (isomorphic-git writes it back so when the
 * memory host copies the commit, and the id must not change).
 */
const messageOf = (message: string) =>
  `${message.replaceAll("\r", "").replace(/^\n+/u, "").replace(/\n+$/u, "")}\n`;

const signature = (who: Identity, at: DateTime.Utc) =>
  `${who.name} <${who.email}> ${Math.floor(DateTime.toEpochMillis(at) / 1000)} +0000`;

/** A commit to write: its tree, parents, people, time and message. */
export interface CommitInput {
  readonly tree: ObjectId;
  readonly parents: readonly CommitSha[];
  readonly author: Identity;
  readonly committer: Identity;
  readonly at: DateTime.Utc;
  readonly message: string;
}

const commitBytes = (input: CommitInput) =>
  encoder.encode(
    [
      `tree ${input.tree}`,
      ...input.parents.map((parent) => `parent ${parent}`),
      `author ${signature(input.author, input.at)}`,
      `committer ${signature(input.committer, input.at)}`,
      "",
      messageOf(input.message),
    ].join("\n")
  );

// ------------------------------------------------------------ the source

const failure = (code: string, path: string) =>
  Promise.reject(Object.assign(new Error(`${code}: ${path}`), { code }));

const clean = (path: string) =>
  `/${path
    .split("/")
    .filter((part) => part !== "")
    .join("/")}`;

/** How isomorphic-git asks for a file: as bytes, or as text in "utf8", alone or as `{ encoding }`. */
type ReadOptions = string | { readonly encoding?: string } | undefined;

const UTF8 = /^utf-?8$/iu;

const wantsText = (options: ReadOptions) =>
  Predicate.isString(options)
    ? UTF8.test(options)
    : UTF8.test(options?.encoding ?? "");

/** A write to the scratch directory through the file system: it only reads. */
const readOnly = (raw: string) => failure("EROFS", clean(raw));

const stats = (kind: "file" | "dir", size: number) => ({
  ctimeMs: 0,
  dev: 1,
  gid: 1,
  ino: 0,
  isDirectory: () => kind === "dir",
  isFile: () => kind === "file",
  isSymbolicLink: () => false,
  mode: kind === "dir" ? 0o4_0000 : 0o10_0644,
  mtimeMs: 0,
  size,
  uid: 1,
});

/**
 * The part of `fs.promises` isomorphic-git calls when a push reads its
 * source (`docs/fs.md` there), over loose objects kept by path. It only
 * reads: the scratch directory is written by `scratch`, never through it.
 */
const readOnlyFs = (files: ReadonlyMap<string, Uint8Array>) => {
  const childrenOf = (dir: string) => {
    const prefix = dir === "/" ? "/" : `${dir}/`;

    return Array.dedupe(
      [...files.keys()].flatMap((path) =>
        path.startsWith(prefix)
          ? [path.slice(prefix.length).split("/")[0] ?? ""]
          : []
      )
    );
  };

  const stat = (raw: string) => {
    const path = clean(raw);
    const file = files.get(path);

    if (file !== undefined) {
      return Promise.resolve(stats("file", file.byteLength));
    }

    return childrenOf(path).length > 0
      ? Promise.resolve(stats("dir", 0))
      : failure("ENOENT", path);
  };

  return {
    promises: {
      lstat: stat,
      mkdir: readOnly,
      // isomorphic-git may call it with no path to learn whether this fs
      // returns promises, so that call answers with a rejected promise.
      readFile: (raw?: string, options?: ReadOptions) => {
        const path = clean(raw ?? "");
        const file = files.get(path);

        if (file === undefined) {
          return failure(
            childrenOf(path).length > 0 ? "EISDIR" : "ENOENT",
            path
          );
        }

        return Promise.resolve(
          wantsText(options) ? decoder.decode(file) : file
        );
      },
      readdir: (raw: string) => {
        const path = clean(raw);
        const children = childrenOf(path);

        return children.length > 0
          ? Promise.resolve(children)
          : failure("ENOENT", path);
      },
      readlink: (raw: string) => failure("EINVAL", clean(raw)),
      rmdir: readOnly,
      stat,
      symlink: (_target: string, raw: string) => failure("ENOSYS", clean(raw)),
      unlink: readOnly,
      writeFile: readOnly,
    },
  };
};

/** A git directory in memory that a push takes objects from, and how to write into it. */
export interface Scratch {
  readonly source: PushSource;
  /** Every blob and tree of `files`, and the root tree's id. */
  readonly tree: (files: Files) => Effect.Effect<ObjectId>;
  readonly commit: (input: CommitInput) => Effect.Effect<CommitSha>;
}

const GITDIR = "/scratch.git";

/** A fresh scratch git directory: loose, zlib-deflated objects named by their ids. */
export const scratch: Effect.Effect<Scratch> = Effect.sync(() => {
  const objects = new Map<string, Uint8Array>();

  const write = (kind: "blob" | "tree" | "commit", content: Uint8Array) =>
    Effect.gen(function* () {
      const { id, raw } = yield* framed(kind, content);
      const path = `${GITDIR}/objects/${id.slice(0, 2)}/${id.slice(2)}`;

      if (!objects.has(path)) {
        objects.set(path, yield* deflate(raw));
      }

      return ObjectId.make(id);
    });

  const folder = (
    files: readonly (readonly [string, string])[]
  ): Effect.Effect<ObjectId> =>
    Effect.gen(function* () {
      const blobs = files.filter(([path]) => !path.includes("/"));

      const nested = Array.groupBy(
        files.filter(([path]) => path.includes("/")),
        ([path]) => path.slice(0, path.indexOf("/"))
      );

      const blobEntries = yield* Effect.forEach(blobs, ([name, text]) =>
        Effect.map(write("blob", encoder.encode(text)), (sha): TreeEntry => ({
          mode: "100644",
          name,
          sha,
          type: "blob",
        }))
      );

      const treeEntries = yield* Effect.forEach(
        Object.entries(nested),
        ([name, inside]) =>
          Effect.map(
            folder(
              inside.map(
                ([path, text]) => [path.slice(name.length + 1), text] as const
              )
            ),
            (sha): TreeEntry => ({ mode: "040000", name, sha, type: "tree" })
          )
      );

      return yield* write("tree", treeBytes([...blobEntries, ...treeEntries]));
    });

  return {
    commit: (input) =>
      Effect.map(write("commit", commitBytes(input)), (id) =>
        CommitSha.make(id)
      ),
    source: { fs: readOnlyFs(objects), gitdir: GITDIR },
    tree: (files) => folder([...files]),
  };
});

// ----------------------------------------------------------------- reads

/** One file of a snapshot: its path, its blob's id and its text. */
const fileOf =
  (path: string, blob: ObjectId) =>
  (bytes: Uint8Array): Snapshot =>
    new Map([
      [path, { blob: BlobSha.make(blob), text: decoder.decode(bytes) }],
    ]);

/** Every file under the tree `tree` of `repo`, by path; none when the repo lacks an object. */
const snapshotOf = (
  repo: RepoName,
  tree: ObjectId,
  prefix: string
): Effect.Effect<Option.Option<Snapshot>, never, RepoHost> =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const entries = yield* host.readTree(repo, tree).pipe(Effect.orDie);

    if (Option.isNone(entries)) {
      return Option.none();
    }

    const each = yield* Effect.forEach(entries.value, (entry) => {
      const path = `${prefix}${entry.name}`;

      if (entry.type === "tree") {
        return snapshotOf(repo, entry.sha, `${path}/`);
      }

      return host
        .readBlob(repo, entry.sha)
        .pipe(Effect.orDie, Effect.map(Option.map(fileOf(path, entry.sha))));
    });

    return Option.map(
      Option.all(each),
      (parts): Snapshot => new Map(parts.flatMap((part) => [...part]))
    );
  });

/** `repo`'s files at `commit`; none when the repo or the commit is not there. */
export const filesAt = (
  repo: RepoName,
  commit: CommitSha
): Effect.Effect<Option.Option<Snapshot>, never, RepoHost> =>
  Effect.gen(function* () {
    const host = yield* RepoHost;

    const found = yield* host
      .readCommit(repo, commit)
      .pipe(Effect.orElseSucceed(() => Option.none()));

    return Option.isNone(found)
      ? Option.none()
      : yield* snapshotOf(repo, found.value.tree, "");
  });
