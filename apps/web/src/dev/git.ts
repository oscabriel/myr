import { ObjectId, RepoHost } from "@repo/artifacts/repo-host";
import type { PushSource, TreeEntry } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { BlobSha, CommitSha } from "@repo/protocol/ids";
import type { Handle, RepoName } from "@repo/protocol/ids";
import { Array, DateTime, Effect, Option, Predicate } from "effect";

export type Files = ReadonlyMap<string, string>;

export interface Held {
  readonly blob: BlobSha;
  readonly text: string;
}

export type Snapshot = ReadonlyMap<string, Held>;

export interface Identity {
  readonly email: string;
  readonly name: string;
}

export const platformIdentity: Identity = {
  email: `platform@${Brand.domain}`,
  name: Brand.name,
};

export const personIdentity = (handle: Handle): Identity => ({
  email: `${handle}@users.${Brand.domain}`,
  name: handle,
});

export const textOf = (snapshot: Snapshot): Files =>
  new Map([...snapshot].map(([path, { text }]) => [path, text]));

export const overlay = (
  files: Files,
  changed: Iterable<readonly [string, string]>
): Files => new Map([...files, ...changed]);

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

const deflate = (bytes: Uint8Array) =>
  Effect.promise(() =>
    new Response(
      new Blob([Uint8Array.from(bytes)])
        .stream()
        .pipeThrough(new CompressionStream("deflate"))
    ).arrayBuffer()
  ).pipe(Effect.map((buffer) => new Uint8Array(buffer)));

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

// No carriage returns, no leading blank lines, one trailing newline: isomorphic-git writes it back so when the
// memory host copies the commit, and the id must not change.
const messageOf = (message: string) =>
  `${message.replaceAll("\r", "").replace(/^\n+/u, "").replace(/\n+$/u, "")}\n`;

const signature = (who: Identity, at: DateTime.Utc) =>
  `${who.name} <${who.email}> ${Math.floor(DateTime.toEpochMillis(at) / 1000)} +0000`;

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

const failure = (code: string, path: string) =>
  Promise.reject(Object.assign(new Error(`${code}: ${path}`), { code }));

const clean = (path: string) =>
  `/${path
    .split("/")
    .filter((part) => part !== "")
    .join("/")}`;

type ReadOptions = string | { readonly encoding?: string } | undefined;

const UTF8 = /^utf-?8$/iu;

const wantsText = (options: ReadOptions) =>
  Predicate.isString(options)
    ? UTF8.test(options)
    : UTF8.test(options?.encoding ?? "");

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

export interface Scratch {
  readonly source: PushSource;
  readonly tree: (files: Files) => Effect.Effect<ObjectId>;
  readonly commit: (input: CommitInput) => Effect.Effect<CommitSha>;
}

const GITDIR = "/scratch.git";

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

const fileOf =
  (path: string, blob: ObjectId) =>
  (bytes: Uint8Array): Snapshot =>
    new Map([
      [path, { blob: BlobSha.make(blob), text: decoder.decode(bytes) }],
    ]);

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
