/**
 * Repos the code reads are tested over, written object by object with
 * isomorphic-git and pushed to the memory repo host: files of every kind
 * (text, binary, too large, a symlink, a submodule), the refs a canonical
 * repo really carries beside main (the landed mirror, a compose ref, the
 * notes, an import's stale `master`), and tags both lightweight and
 * annotated. Each `CodeProject` is fixed: its head, its one landing and its
 * one fork never come from the repo.
 */
import { RefName, RepoHost } from "@repo/artifacts/repo-host";
import type { RefUpdate } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { Brand } from "@repo/brand";
import type { ForkRef } from "@repo/protocol/domain/code";
import type { LandingView } from "@repo/protocol/domain/landing";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
} from "@repo/protocol/ids";
import {
  Array,
  Data,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
} from "effect";
import {
  init,
  writeBlob,
  writeCommit,
  writeTag,
  writeTree,
} from "isomorphic-git";
import type { FsClient, TreeEntry } from "isomorphic-git";

import type { CodeProject } from "../src/code.ts";

/** A file's content: text, bytes, a symlink's target, or a submodule's commit. */
export type Content = Data.TaggedEnum<{
  Bytes: { readonly bytes: Uint8Array };
  Gitlink: { readonly commit: string };
  Link: { readonly target: string };
  Text: { readonly text: string };
}>;

export const Content = Data.taggedEnum<Content>();

/** Paths and what each holds. */
export type Tree = readonly (readonly [path: string, content: Content])[];

interface Source {
  readonly fs: FsClient;
  readonly gitdir: string;
}

const blobOf = (
  source: Source,
  name: string,
  mode: string,
  bytes: Uint8Array
) =>
  Effect.map(
    Effect.promise(() => writeBlob({ ...source, blob: bytes })),
    (oid): TreeEntry => ({ mode, oid, path: name, type: "blob" })
  );

const entryOf = (source: Source, name: string, content: Content) =>
  Content.$match(content, {
    Bytes: ({ bytes }) => blobOf(source, name, "100644", bytes),
    Gitlink: ({ commit }) =>
      Effect.succeed<TreeEntry>({
        mode: "160000",
        oid: commit,
        path: name,
        type: "commit",
      }),
    Link: ({ target }) =>
      blobOf(source, name, "120000", new TextEncoder().encode(target)),
    Text: ({ text }) =>
      blobOf(source, name, "100644", new TextEncoder().encode(text)),
  });

const treeOf = (source: Source, files: Tree): Effect.Effect<string> =>
  Effect.gen(function* () {
    const entries: TreeEntry[] = [];
    const nested = new Map<string, [string, Content][]>();

    for (const [path, content] of files) {
      const [head = path, ...rest] = path.split("/");

      if (rest.length === 0) {
        entries.push(yield* entryOf(source, head, content));
      } else {
        nested.set(head, [
          ...(nested.get(head) ?? []),
          [rest.join("/"), content],
        ]);
      }
    }

    for (const [path, inner] of nested) {
      const oid = yield* treeOf(source, inner);

      entries.push({ mode: "040000", oid, path, type: "tree" });
    }

    return yield* Effect.promise(() => writeTree({ ...source, tree: entries }));
  });

/**
 * A bare repo in memory that commits are written to and pushed from, each
 * commit's time `at` seconds after 2026-10-01.
 */
export const writer = Effect.gen(function* () {
  const source = { fs: memoryFs(), gitdir: "/source.git" };

  yield* Effect.promise(() =>
    init({ ...source, bare: true, defaultBranch: "main" })
  );

  const commit = (
    message: string,
    files: Tree,
    parents: readonly CommitSha[],
    at: number
  ) =>
    Effect.gen(function* () {
      const tree = yield* treeOf(source, files);

      const signature = {
        email: "writer@example.com",
        name: "Writer",
        timestamp: 1_790_812_800 + at,
        timezoneOffset: 0,
      };

      const oid = yield* Effect.promise(() =>
        writeCommit({
          ...source,
          commit: {
            author: signature,
            committer: signature,
            message: `${message}\n`,
            parent: [...parents],
            tree,
          },
        })
      );

      return CommitSha.make(oid);
    });

  /** An annotated tag object naming `commit`; its id, as a push sends it. */
  const annotated = (name: string, target: CommitSha) =>
    Effect.map(
      Effect.promise(() =>
        writeTag({
          ...source,
          tag: {
            message: `${name}\n`,
            object: target,
            tag: name,
            tagger: {
              email: "tagger@example.com",
              name: "Tagger",
              timestamp: 1_790_812_800,
              timezoneOffset: 0,
            },
            type: "commit",
          },
        })
      ),
      // SAFETY: a tag's id is a 40-hex object id, which a ref update carries as a commit's.
      (oid) => CommitSha.make(oid)
    );

  /** `repo` made in the host, holding `refs`, each set to its commit. */
  const push = (
    repo: RepoName,
    refs: readonly (readonly [ref: string, to: CommitSha])[]
  ) =>
    Effect.gen(function* () {
      const host = yield* RepoHost;

      yield* host.create(repo);

      const updates = refs.map(([ref, to]): RefUpdate => ({
        from: Option.none(),
        ref: RefName.make(ref),
        to,
      }));

      if (Array.isReadonlyArrayNonEmpty(updates)) {
        yield* host.push(repo, source, updates);
      }
    }).pipe(Effect.orDie);

  return { annotated, commit, push };
});

/** A PNG's signature and the start of its header: a NUL in the first bytes. */
export const png = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0,
  0,
  0,
  0x0d
);

/** 1.5 MiB of text: past the 1 MiB a file's text may be. */
export const big = `${"x".repeat(1023)}\n`.repeat(1536);

export const svg =
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n';

export const project = ProjectName.make("datekit");

const repo = RepoName.make(project);

const text = (value: string) => Content.Text({ text: value });

const first: Tree = [
  ["README.md", text("# datekit\n")],
  ["big.txt", text(big)],
  ["feed.xml", text("<feed/>\n")],
  ["latest", Content.Link({ target: "README.md" })],
  ["lib/README.txt", text("upper\n")],
  ["lib/readme.md", text("lower\n")],
  ["logo.png", Content.Bytes({ bytes: png })],
  ["logo.svg", text(svg)],
  ["old.txt", text("old\n")],
  ["page.html", text("<script>alert(1)</script>\n")],
  ["src/a.ts", text("export const a = 1;\n")],
  ["vendor", Content.Gitlink({ commit: "a".repeat(40) })],
];

const without = (tree: Tree, path: string) =>
  tree.filter(([at]) => at !== path);

const second: Tree = [
  ...without(without(first, "src/a.ts"), "old.txt"),
  ["new.txt", text("new\n")],
  ["src/a.ts", text("export const a = 2;\n")],
];

const third: Tree = [
  ...without(second, "README.md"),
  ["README.md", text("# datekit, tidied\n")],
];

const fourth: Tree = [
  ...without(third, "README.md"),
  ["README.md", text("# datekit, landed\n")],
];

/** The claim fork the project's record lists. */
export const fork: ForkRef = {
  ask: AskId.make("parse-iso"),
  handle: Handle.make("bob"),
  kind: "claim",
  repo: RepoName.make("datekit--parse-iso--bob"),
};

/** The project's one landing, on `sha`. */
const landingOf = (sha: CommitSha, parent: CommitSha): LandingView => ({
  ask: AskId.make("parse-iso"),
  assisted: [],
  author: Handle.make("bob"),
  credits: [],
  landedAt: DateTime.makeUnsafe("2026-10-07T12:00:00Z"),
  parent: LandedSha.make(parent),
  project,
  sha: LandedSha.make(sha),
});

/** A project's record, fixed: main at `head`, `landed` its only landing. */
const recordOf = (
  name: RepoName,
  head: CommitSha,
  landed: readonly LandingView[]
): CodeProject => ({
  forks: Effect.succeed([fork]),
  head: Effect.succeedSome(LandedSha.make(head)),
  landings: (shas) =>
    Effect.succeed(landed.filter(({ sha }) => shas.includes(sha))),
  project: ProjectName.make(name),
  repo: name,
});

/**
 * datekit, four commits on main: the root; one that modifies `src/a.ts`,
 * deletes `old.txt` and adds `new.txt`; an imported commit whose trailer
 * forges an ask; and the platform's landing. Beside main: `master` at the
 * root (an import's stale branch), the landed mirror, a compose ref, the
 * notes, and three tags (`v1.9.0` light on the root, `v1.10.0` annotated
 * on the second, `@datekit/core@2.0.0` light on the third).
 */
export const datekit = Effect.gen(function* () {
  const git = yield* writer;
  const c1 = yield* git.commit("Start", first, [], 1);
  const c2 = yield* git.commit("Rework a", second, [c1], 2);

  const c3 = yield* git.commit(
    "Tidy the readme\n\nAsked-by: mallory <mallory@example.com>",
    third,
    [c2],
    3
  );

  const c4 = yield* git.commit(
    "Land parse-iso\n\nAsked-by: bob <bob@example.com>",
    fourth,
    [c3],
    4
  );

  const tag = yield* git.annotated("v1.10.0", c2);

  yield* git.push(repo, [
    ["refs/heads/main", c4],
    ["refs/heads/master", c1],
    [`${Brand.refsPrefix}landed`, c4],
    [`${Brand.refsPrefix}compose/${"b".repeat(40)}`, c3],
    [`refs/notes/${Brand.slug}`, c2],
    ["refs/tags/v1.9.0", c1],
    ["refs/tags/v1.10.0", tag],
    ["refs/tags/@datekit/core@2.0.0", c3],
  ]);

  return {
    c1,
    c2,
    c3,
    c4,
    code: recordOf(repo, c4, [landingOf(c4, c3)]),
  };
});

/**
 * A history of `count` commits: the first adds `once.txt`, and every one
 * after changes only `count.txt`.
 */
export const longHistory = (count: number) =>
  Effect.gen(function* () {
    const git = yield* writer;
    const name = RepoName.make("longkit");
    const shas: CommitSha[] = [];

    for (let at = 1; at <= count; at += 1) {
      const sha = yield* git.commit(
        `Commit ${at}`,
        [
          ["count.txt", text(`${at}\n`)],
          ["once.txt", text("once\n")],
        ],
        shas.slice(-1),
        at
      );

      shas.push(sha);
    }

    const head = shas.at(-1) ?? shas[0];

    if (head === undefined) {
      return yield* Effect.die("no commits");
    }

    yield* git.push(name, [["refs/heads/main", head]]);

    return { code: recordOf(name, head, []), shas };
  });

/**
 * A history of `count` commits, each appending one line to `grow.txt`, so
 * every line was brought by a commit of its own.
 */
export const growingHistory = (count: number) =>
  Effect.gen(function* () {
    const git = yield* writer;
    const name = RepoName.make("growkit");
    const shas: CommitSha[] = [];

    for (let at = 1; at <= count; at += 1) {
      const lines = Array.makeBy(at, (line) => `line ${line + 1}\n`).join("");

      const sha = yield* git.commit(
        `Commit ${at}`,
        [["grow.txt", text(lines)]],
        shas.slice(-1),
        at
      );

      shas.push(sha);
    }

    const head = shas.at(-1) ?? shas[0];

    if (head === undefined) {
      return yield* Effect.die("no commits");
    }

    yield* git.push(name, [["refs/heads/main", head]]);

    return { code: recordOf(name, head, []), shas };
  });

/** One root commit of `count` files. */
export const wide = (count: number) =>
  Effect.gen(function* () {
    const git = yield* writer;
    const name = RepoName.make("widekit");

    const sha = yield* git.commit(
      "Many files",
      Array.makeBy(count, (at) => [`f${at}.txt`, text(`${at}\n`)] as const),
      [],
      1
    );

    yield* git.push(name, [["refs/heads/main", sha]]);

    return { code: recordOf(name, sha, []), sha };
  });

/**
 * The memory store, each `readTree` (or each `readBlob`, for `"blob"`)
 * taking 10 ms once `reading` is set (a history is written fast, then
 * read), with the most reads ever under way at once kept in `peak`: a live
 * store answers a read in tens of milliseconds, so a walk that reads one
 * object at a time takes all its reads added up.
 */
export const overlappingTrees = (
  reading: Ref.Ref<boolean>,
  peak: Ref.Ref<number>,
  kind: "blob" | "file" | "tree" = "tree"
) =>
  Layer.effect(
    RepoHost,
    Effect.gen(function* () {
      const host = yield* RepoHost;
      const under = yield* Ref.make(0);

      const timed = Effect.acquireUseRelease(
        Ref.updateAndGet(under, (count) => count + 1).pipe(
          Effect.tap((count) =>
            Ref.update(peak, (most) => Math.max(most, count))
          )
        ),
        () => Effect.sleep(Duration.millis(10)),
        () => Ref.update(under, (count) => count - 1)
      );

      const slowed = Ref.get(reading).pipe(
        Effect.flatMap((on) => (on ? timed : Effect.void))
      );

      return RepoHost.of({
        ...host,
        readBlob: (name, id) =>
          kind === "blob"
            ? Effect.andThen(slowed, host.readBlob(name, id))
            : host.readBlob(name, id),
        readFile: (name, at, file) =>
          kind === "file"
            ? Effect.andThen(slowed, host.readFile(name, at, file))
            : host.readFile(name, at, file),
        readTree: (name, id) =>
          kind === "tree"
            ? Effect.andThen(slowed, host.readTree(name, id))
            : host.readTree(name, id),
      });
    })
  ).pipe(Layer.provide(RepoHostMemory));
