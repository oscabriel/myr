/**
 * A project's code as readers browse it, read from its canonical repo over
 * the memory repo host, with main, the landings and the forks taken from a
 * fixed project record: refs without the platform's internals, folders and
 * their READMEs, revisions that resolve only to main, a commit or a tag,
 * files within their caps, the first-parent log with its landings, a
 * commit's changes, and reads by object id kept once read.
 */
import { describe, expect, it } from "@effect/vitest";
import { RepoHost } from "@repo/artifacts/repo-host";
import { RepoHostMemory } from "@repo/artifacts/repo-host/memory";
import { Brand } from "@repo/brand";
import { CommitDiff } from "@repo/protocol/domain/code";
import { CommitSha, RepoName, RepoPath } from "@repo/protocol/ids";
import {
  UnknownCommit,
  UnknownPath,
  UnknownRevision,
} from "@repo/protocol/refusal";
import {
  DateTime,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";

import { CodeStore } from "../src/code-store.ts";
import { CodeStoreMemory } from "../src/code-store/memory.ts";
import {
  commitOf,
  fileOf,
  logOf,
  pathsOf,
  refsOf,
  treeOf,
} from "../src/code.ts";
import { CodeCache, CodeCacheLive } from "../src/code/cache.ts";
import { commitKey, DIFF_TEXT } from "../src/code/commit.ts";
import { filesUnder } from "../src/code/paths.ts";
import { compareTags } from "../src/code/refs.ts";
import { READS_AT_ONCE } from "../src/code/tree.ts";
import {
  big,
  Content,
  datekit,
  fork,
  linkedReadmes,
  longHistory,
  project,
  overlappingTrees,
  wide,
  writer,
} from "./code-fixtures.ts";

const revision = (name: string) => Option.some(name);

const main = Option.none();

const path = (text: string) => Option.some(RepoPath.make(text));

const page = { at: main, from: 0, limit: 30, path: Option.none() };

/**
 * A history of hundreds of commits, written and pushed in memory: well
 * under a second alone, many times that beside every other package's tests.
 */
const long = { timeout: 30_000 };

describe("a project's refs", () => {
  it.effect(
    "are main's landed commit, its tags newest first and its forks, and nothing of the platform's own",
    () =>
      Effect.gen(function* () {
        const { c1, c2, c3, c4, code } = yield* datekit;

        expect(yield* refsOf(code)).toStrictEqual({
          forks: [fork],
          landed: c4,
          project,
          tags: [
            { name: "v1.10.0", sha: c2 },
            { name: "v1.9.0", sha: c1 },
            { name: "@datekit/core@2.0.0", sha: c3 },
          ],
        });
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it("sort by version, newest first, each package's together", () => {
    expect(
      [
        "v1.9.0",
        "v1.10.0",
        "v1.10.0-beta.1",
        "v2.0.0",
        "@changesets/cli@2.27.1",
        "@changesets/cli@2.3.0",
        "@changesets/apply@1.0.0",
      ].toSorted(compareTags)
    ).toStrictEqual([
      "v2.0.0",
      "v1.10.0",
      "v1.10.0-beta.1",
      "v1.9.0",
      "@changesets/cli@2.27.1",
      "@changesets/cli@2.3.0",
      "@changesets/apply@1.0.0",
    ]);
  });
});

describe("a folder", () => {
  it.effect(
    "lists folders first, then files by name, each by its kind, with its README",
    () =>
      Effect.gen(function* () {
        const { c4, code } = yield* datekit;
        const listing = yield* treeOf(code, main, Option.none());

        expect(listing.at).toBe(c4);
        expect(listing.path).toBeUndefined();
        expect(
          listing.entries.map(({ name, path: at, type }) => [name, at, type])
        ).toStrictEqual([
          ["lib", "lib", "tree"],
          ["src", "src", "tree"],
          ["README.md", "README.md", "blob"],
          ["big.txt", "big.txt", "blob"],
          ["feed.xml", "feed.xml", "blob"],
          ["latest", "latest", "symlink"],
          ["logo.png", "logo.png", "blob"],
          ["logo.svg", "logo.svg", "blob"],
          ["new.txt", "new.txt", "blob"],
          ["page.html", "page.html", "blob"],
          ["vendor", "vendor", "submodule"],
        ]);
        expect({
          readme: listing.readme,
          vendor: listing.entries.find(({ name }) => name === "vendor"),
        }).toMatchObject({
          readme: {
            path: "README.md",
            sha: listing.entries.find(({ name }) => name === "README.md")?.sha,
          },
          vendor: { mode: "160000", sha: "a".repeat(40) },
        });
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("finds a lowercase readme.md before a README.txt", () =>
    Effect.gen(function* () {
      const { code } = yield* datekit;
      const listing = yield* treeOf(code, main, path("lib"));

      expect(listing.path).toBe("lib");
      expect(listing.entries.map(({ path: at }) => at)).toStrictEqual([
        "lib/README.txt",
        "lib/readme.md",
      ]);
      expect(listing.readme?.path).toBe("lib/readme.md");
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "follows a README that is a symlink to the file it names in the repo, and reads it there",
    () =>
      Effect.gen(function* () {
        const { code } = yield* linkedReadmes;
        const root = yield* treeOf(code, main, Option.none());
        const crate = yield* treeOf(code, main, path("crate"));
        const docs = yield* treeOf(code, main, path("docs"));
        const target = crate.entries.find(({ name }) => name === "README.md");

        expect(
          root.entries.find(({ name }) => name === "README.md")?.type
        ).toBe("symlink");
        expect([root.readme, docs.readme]).toStrictEqual([
          { path: "crate/README.md", sha: target?.sha },
          { path: "crate/README.md", sha: target?.sha },
        ]);
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "has no README where its symlink leaves the repo, names nothing, or names a folder",
    () =>
      Effect.gen(function* () {
        const { code } = yield* linkedReadmes;

        const readmes = yield* Effect.forEach(["out", "gone", "folder"], (at) =>
          Effect.map(treeOf(code, main, path(at)), ({ readme }) => readme)
        );

        expect(readmes).toStrictEqual([undefined, undefined, undefined]);
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("is UnknownPath when missing, or a file", () =>
    Effect.gen(function* () {
      const { c4, code } = yield* datekit;

      expect(
        yield* Effect.exit(treeOf(code, main, path("nope")))
      ).toStrictEqual(
        Exit.fail(new UnknownPath({ commit: c4, path: RepoPath.make("nope") }))
      );
      expect(
        yield* Effect.exit(treeOf(code, main, path("src/a.ts/x")))
      ).toStrictEqual(
        Exit.fail(
          new UnknownPath({ commit: c4, path: RepoPath.make("src/a.ts/x") })
        )
      );
      expect(
        yield* Effect.exit(treeOf(code, main, path("README.md")))
      ).toStrictEqual(
        Exit.fail(
          new UnknownPath({ commit: c4, path: RepoPath.make("README.md") })
        )
      );
    }).pipe(Effect.provide(RepoHostMemory))
  );
});

describe("a revision", () => {
  it.effect(
    "is main, a commit the repo holds, or a tag by its exact name, peeled",
    () =>
      Effect.gen(function* () {
        const { c1, c2, c3, c4, code } = yield* datekit;

        const resolved = (rev: string) =>
          Effect.map(
            treeOf(code, revision(rev), Option.none()),
            ({ at: sha }) => sha
          );

        expect(
          yield* Effect.all([
            resolved("main"),
            resolved(c1),
            resolved("v1.9.0"),
            resolved("v1.10.0"),
            resolved("@datekit/core@2.0.0"),
          ])
        ).toStrictEqual([c4, c1, c1, c2, c3]);
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "is UnknownRevision for anything else, a ref path or another branch included",
    () =>
      Effect.gen(function* () {
        const { code } = yield* datekit;

        const refused = [
          "v9",
          "master",
          "../heads/master",
          "refs/heads/master",
          "refs/tags/v1.9.0",
          `${Brand.refsPrefix}landed`,
          "f".repeat(40),
          "HEAD",
        ];

        expect(
          yield* Effect.forEach(refused, (rev) =>
            Effect.exit(treeOf(code, revision(rev), Option.none()))
          )
        ).toStrictEqual(
          refused.map((rev) => Exit.fail(new UnknownRevision({ rev })))
        );
      }).pipe(Effect.provide(RepoHostMemory))
  );
});

describe("a file", () => {
  it.effect("is its text, with its blob id and size", () =>
    Effect.gen(function* () {
      const { c4, code } = yield* datekit;
      const listing = yield* treeOf(code, main, Option.none());

      expect(
        yield* fileOf(code, main, RepoPath.make("README.md"))
      ).toStrictEqual({
        at: c4,
        binary: false,
        path: "README.md",
        sha: listing.readme?.sha,
        size: 18,
        text: "# datekit, landed\n",
        truncated: false,
      });
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("past 1 MiB is truncated, with no text", () =>
    Effect.gen(function* () {
      const { code } = yield* datekit;
      const file = yield* fileOf(code, main, RepoPath.make("big.txt"));

      expect(file).toMatchObject({
        binary: false,
        size: big.length,
        truncated: true,
      });
      expect(file.text).toBeUndefined();
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("with a NUL among its first bytes is binary, with no text", () =>
    Effect.gen(function* () {
      const { code } = yield* datekit;
      const file = yield* fileOf(code, main, RepoPath.make("logo.png"));

      expect(file).toMatchObject({ binary: true, size: 12, truncated: false });
      expect(file.text).toBeUndefined();
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("is UnknownPath for a folder or a missing path", () =>
    Effect.gen(function* () {
      const { c4, code } = yield* datekit;

      expect(
        yield* Effect.exit(fileOf(code, main, RepoPath.make("src")))
      ).toStrictEqual(
        Exit.fail(new UnknownPath({ commit: c4, path: RepoPath.make("src") }))
      );
      expect(
        yield* Effect.exit(fileOf(code, main, RepoPath.make("src/b.ts")))
      ).toStrictEqual(
        Exit.fail(
          new UnknownPath({ commit: c4, path: RepoPath.make("src/b.ts") })
        )
      );
    }).pipe(Effect.provide(RepoHostMemory))
  );
});

describe("every path", () => {
  it.effect("lists each file, symlink and submodule at the revision", () =>
    Effect.gen(function* () {
      const { c1, code } = yield* datekit;

      expect(yield* pathsOf(code, revision(c1))).toStrictEqual({
        at: c1,
        paths: [
          "README.md",
          "big.txt",
          "feed.xml",
          "latest",
          "lib/README.txt",
          "lib/readme.md",
          "logo.png",
          "logo.svg",
          "old.txt",
          "page.html",
          "src/a.ts",
          "vendor",
        ],
        truncated: false,
      });
    }).pipe(Effect.provide(RepoHostMemory))
  );
});

describe("every path past the cap", () => {
  it.effect(
    "is the first by path among the folders read before the cap, truncated",
    () =>
      Effect.gen(function* () {
        const { c1, code } = yield* datekit;
        const host = yield* RepoHost;
        const commit = yield* host.readCommit(code.repo, c1);
        const { tree } = Option.getOrThrow(commit);
        const capped = yield* filesUnder(code.repo, tree, 3);

        // The root alone holds nine files, so no folder below it is read.
        expect({
          paths: capped.files.map(({ path: at }) => at),
          truncated: capped.truncated,
        }).toStrictEqual({
          paths: ["README.md", "big.txt", "feed.xml"],
          truncated: true,
        });
        expect((yield* filesUnder(code.repo, tree, 12)).truncated).toBeFalsy();
      }).pipe(Effect.provide(RepoHostMemory))
  );
});

describe("the log", () => {
  it.effect(
    "is first parents from the revision, each landing with the platform's record and no other",
    () =>
      Effect.gen(function* () {
        const { c1, c2, c3, c4, code } = yield* datekit;
        const { commits, next } = yield* logOf(code, page);

        expect(next).toBeUndefined();
        expect(commits.map(({ sha }) => sha)).toStrictEqual([c4, c3, c2, c1]);

        const [landed, imported] = commits;

        expect(landed?.landing).toMatchObject({ ask: "parse-iso", sha: c4 });
        expect(imported?.landing).toBeUndefined();
        expect(
          Option.map(Option.fromUndefinedOr(imported), (commit) => ({
            at: DateTime.formatIso(commit.author.at),
            email: commit.author.email,
            name: commit.author.name,
            parents: commit.parents,
            subject: commit.subject,
            trailers: commit.trailers,
          }))
        ).toStrictEqual(
          Option.some({
            at: "2026-10-01T00:00:03.000Z",
            email: "writer@example.com",
            name: "Writer",
            parents: [c2],
            subject: "Tidy the readme",
            trailers: [
              { key: "Asked-by", value: "mallory <mallory@example.com>" },
            ],
          })
        );
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "pages 30 at a time, naming where the next page starts",
    () =>
      Effect.gen(function* () {
        const { code, shas } = yield* longHistory(250);
        const first = yield* logOf(code, page);

        expect(first.commits).toHaveLength(30);
        expect(first.commits[0]?.sha).toBe(shas[249]);
        expect(first.next).toBe(30);

        const last = yield* logOf(code, { ...page, from: 240 });

        expect(last.commits.map(({ sha }) => sha)).toStrictEqual(
          shas.slice(0, 10).toReversed()
        );
        expect(last.next).toBeUndefined();
      }).pipe(Effect.provide(RepoHostMemory)),
    long
  );

  it.effect(
    "for a path, keeps only the commits that changed it, scanning at most 200 a call",
    () =>
      Effect.gen(function* () {
        const { code, shas } = yield* longHistory(250);
        const once = { ...page, path: path("once.txt") };
        const scanned = yield* logOf(code, once);

        expect(scanned).toStrictEqual({ commits: [], next: 200 });

        const older = yield* logOf(code, { ...once, from: 200 });

        expect(older.commits.map(({ sha }) => sha)).toStrictEqual([shas[0]]);
        expect(older.next).toBeUndefined();

        const counted = yield* logOf(code, {
          ...page,
          limit: 3,
          path: path("count.txt"),
        });

        expect(counted.commits.map(({ sha }) => sha)).toStrictEqual(
          shas.slice(247).toReversed()
        );
        expect(counted.next).toBe(3);
      }).pipe(Effect.provide(RepoHostMemory)),
    long
  );
});

describe("a path's log, read live", () => {
  it.live(
    "reads the file in its commits several at a time, not one after another",
    () =>
      Effect.gen(function* () {
        const reading = yield* Ref.make(false);
        const peak = yield* Ref.make(0);

        yield* Effect.gen(function* () {
          const { code, shas } = yield* longHistory(64);

          yield* Ref.set(reading, true);

          const { commits } = yield* logOf(code, {
            ...page,
            path: path("once.txt"),
          });

          expect(commits.map(({ sha }) => sha)).toStrictEqual([shas[0]]);
        }).pipe(Effect.provide(overlappingTrees(reading, peak, "file")));

        // 64 commits, the file read whole in each: one at a time a live
        // store took a minute for 200; `READS_AT_ONCE` commits at once now.
        expect(yield* Ref.get(peak)).toBeGreaterThanOrEqual(32);
        expect(yield* Ref.get(peak)).toBeLessThanOrEqual(READS_AT_ONCE);
      }),
    long
  );
});

describe("a commit", () => {
  it.effect("at the root adds every file", () =>
    Effect.gen(function* () {
      const { c1, code } = yield* datekit;
      const diff = yield* commitOf(code, c1);

      expect([diff.commit.sha, diff.truncated]).toStrictEqual([c1, false]);
      expect(
        diff.files.map(({ path: at, status }) => [at, status])
      ).toStrictEqual(
        (yield* pathsOf(code, revision(c1))).paths.map((at) => [at, "added"])
      );
      expect(
        diff.files.find(({ path: at }) => at === "src/a.ts")
      ).toMatchObject({ binary: false, newText: "export const a = 1;\n" });

      const logo = diff.files.find(({ path: at }) => at === "logo.png");

      expect([logo?.binary, logo?.newText]).toStrictEqual([true, undefined]);
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "after it shows each change against the first parent, with both blob ids",
    () =>
      Effect.gen(function* () {
        const { c2, code } = yield* datekit;
        const diff = yield* commitOf(code, c2);

        expect(
          diff.files.map(({ before, after, path: at, status }) => [
            at,
            status,
            before !== undefined,
            after !== undefined,
          ])
        ).toStrictEqual([
          ["new.txt", "added", false, true],
          ["old.txt", "deleted", true, false],
          ["src/a.ts", "modified", true, true],
        ]);
        expect(
          diff.files.find(({ path: at }) => at === "src/a.ts")
        ).toMatchObject({
          newText: "export const a = 2;\n",
          oldText: "export const a = 1;\n",
        });
        expect(diff.commit.landing).toBeUndefined();
      }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect(
    "past 300 files lists paths only, truncated",
    () =>
      Effect.gen(function* () {
        const { code, sha } = yield* wide(301);
        const diff = yield* commitOf(code, sha);

        expect([diff.truncated, diff.files.length]).toStrictEqual([true, 301]);
        expect(
          diff.files.filter(
            ({ newText, oldText }) =>
              newText !== undefined || oldText !== undefined
          )
        ).toStrictEqual([]);
      }).pipe(Effect.provide(RepoHostMemory)),
    long
  );

  it.effect("the repo does not hold is UnknownCommit", () =>
    Effect.gen(function* () {
      const { code } = yield* datekit;
      const missing = CommitSha.make("f".repeat(40));

      expect(yield* Effect.exit(commitOf(code, missing))).toStrictEqual(
        Exit.fail(new UnknownCommit({ sha: missing }))
      );
    }).pipe(Effect.provide(RepoHostMemory))
  );
});

/** 150 KiB of text: fourteen of them run past a diff's 2 MiB of text. */
const sizable = (name: string) => `${name.padEnd(1023, "y")}\n`.repeat(150);

/**
 * One commit modifying twenty files, `f00.txt` to `f19.txt`, each from a
 * line to 150 KiB but `f14.txt`, which stays small: thirteen fit the text
 * budget, `f13.txt` runs past it, and every file after it is a path only.
 */
const twentyFiles = Effect.gen(function* () {
  const git = yield* writer;
  const name = RepoName.make("twentykit");

  const paths = Array.from(
    { length: 20 },
    (_, at) => `f${String(at).padStart(2, "0")}.txt`
  );

  const before = yield* git.commit(
    "Small",
    paths.map((at) => [at, Content.Text({ text: `${at}\n` })] as const),
    [],
    1
  );

  const after = yield* git.commit(
    "Large",
    paths.map(
      (at) =>
        [
          at,
          Content.Text({
            text: at === "f14.txt" ? "small\n" : sizable(at),
          }),
        ] as const
    ),
    [before],
    2
  );

  yield* git.push(name, [["refs/heads/main", after]]);

  return {
    after,
    code: {
      forks: Effect.succeed([]),
      head: Effect.succeedNone,
      landings: () => Effect.succeed([]),
      project,
      repo: name,
    },
    paths,
  };
});

describe("a commit's texts, read live", () => {
  it.live(
    "are read several at a time, and cut at the budget in path order as one after another would",
    () =>
      Effect.gen(function* () {
        const reading = yield* Ref.make(false);
        const peak = yield* Ref.make(0);

        const { diff, paths } = yield* Effect.gen(function* () {
          const made = yield* twentyFiles;

          yield* Ref.set(reading, true);

          return {
            diff: yield* commitOf(made.code, made.after),
            paths: made.paths,
          };
        }).pipe(Effect.provide(overlappingTrees(reading, peak, "blob")));

        const most = yield* Ref.get(peak);

        // Thirteen files' texts fit the budget, and a fourteenth does not.
        expect([
          13 * sizable("f00.txt").length <= DIFF_TEXT,
          14 * sizable("f00.txt").length > DIFF_TEXT,
        ]).toStrictEqual([true, true]);
        expect({
          files: diff.files.map(({ newText, oldText, path: at, status }) => [
            at,
            status,
            oldText,
            newText,
          ]),
          truncated: diff.truncated,
        }).toStrictEqual({
          files: paths.map((at, index) =>
            index < 13
              ? [at, "modified", `${at}\n`, sizable(at)]
              : [at, "modified", undefined, undefined]
          ),
          truncated: true,
        });
        // Several at once, never past the fan-out of 8.
        expect([most > 1, most <= 8]).toStrictEqual([true, true]);
      }),
    long
  );
});

/** The memory store, with each blob `readBlob` is asked for counted in `reads`. */
const blobsCountedBy = (reads: Ref.Ref<number>) =>
  Layer.effect(
    RepoHost,
    Effect.gen(function* () {
      const host = yield* RepoHost;

      return RepoHost.of({
        ...host,
        readBlob: (name, blob) =>
          Ref.update(reads, (count) => count + 1).pipe(
            Effect.andThen(host.readBlob(name, blob))
          ),
      });
    })
  ).pipe(Layer.provide(RepoHostMemory));

/** What the store keeps under a key, as a diff, if it holds one that decodes. */
const keptUnder = (key: string) =>
  Effect.map(
    Effect.flatMap(Effect.service(CodeStore), (store) => store.get(key)),
    Option.flatMap(
      Schema.decodeUnknownOption(Schema.fromJsonString(CommitDiff))
    )
  );

describe("a commit kept by its id", () => {
  it.effect(
    "is kept without its landing, read again with no blob read, and its landing still asked for",
    () =>
      Effect.gen(function* () {
        const blobs = yield* Ref.make(0);
        const asked = yield* Ref.make<readonly (readonly CommitSha[])[]>([]);

        yield* Effect.gen(function* () {
          const { c4, code } = yield* datekit;

          const counted = {
            ...code,
            landings: (shas: readonly CommitSha[]) =>
              Ref.update(asked, (all) => [...all, shas]).pipe(
                Effect.andThen(code.landings(shas))
              ),
          };

          const first = yield* commitOf(counted, c4);
          const read = yield* Ref.get(blobs);

          expect([first.commit.landing?.sha, read > 0]).toStrictEqual([
            c4,
            true,
          ]);

          const kept = yield* keptUnder(commitKey(code.repo, c4));

          // Kept with no landing: the rest is the diff as it was answered.
          expect(
            Option.map(kept, (decoded) => ({
              kept: decoded.commit.landing,
              restored: {
                ...decoded,
                commit: { ...decoded.commit, landing: first.commit.landing },
              },
            }))
          ).toStrictEqual(Option.some({ kept: undefined, restored: first }));

          const second = yield* commitOf(counted, c4);

          expect({
            asked: yield* Ref.get(asked),
            blobs: yield* Ref.get(blobs),
            second,
          }).toStrictEqual({ asked: [[c4], [c4]], blobs: read, second: first });
        }).pipe(
          Effect.provide(Layer.merge(blobsCountedBy(blobs), CodeStoreMemory))
        );
      })
  );

  it.effect("is computed again when what is kept no longer decodes", () =>
    Effect.gen(function* () {
      const blobs = yield* Ref.make(0);

      yield* Effect.gen(function* () {
        const { c2, code } = yield* datekit;
        const store = yield* CodeStore;
        const key = commitKey(code.repo, c2);

        const fresh = yield* commitOf(code, c2).pipe(
          Effect.provideService(CodeStore, CodeStore.defaultValue())
        );

        const read = yield* Ref.get(blobs);

        yield* store.put(key, '{"files":"no longer a diff"}');

        expect(yield* commitOf(code, c2)).toStrictEqual(fresh);
        expect(yield* Ref.get(blobs)).toBe(2 * read);
        expect(yield* keptUnder(key)).toStrictEqual(Option.some(fresh));
      }).pipe(
        Effect.provide(Layer.merge(blobsCountedBy(blobs), CodeStoreMemory))
      );
    })
  );
});

/** The memory store, with each tree id `readTree` is asked for counted in `reads`. */
const countedBy = (reads: Ref.Ref<readonly string[]>) =>
  Layer.effect(
    RepoHost,
    Effect.gen(function* () {
      const host = yield* RepoHost;

      return RepoHost.of({
        ...host,
        readTree: (name, tree) =>
          Ref.update(reads, (all) => [...all, tree]).pipe(
            Effect.andThen(host.readTree(name, tree))
          ),
      });
    })
  ).pipe(Layer.provide(RepoHostMemory));

describe("reads by object id", () => {
  it.effect("are kept once read, while main resolves every time", () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make<readonly string[]>([]);

      yield* Effect.gen(function* () {
        const { code } = yield* datekit;
        const first = yield* treeOf(code, main, Option.none());
        const counted = (yield* Ref.get(reads)).length;

        expect(counted).toBeGreaterThan(0);

        const again = yield* treeOf(code, main, Option.none());

        expect(again).toStrictEqual(first);
        expect(yield* Ref.get(reads)).toHaveLength(counted);
      }).pipe(
        Effect.provide(Layer.merge(countedBy(reads), CodeCacheLive(100)))
      );
    })
  );

  it.effect("keep heavy reads apart, so many texts never push out a tree", () =>
    Effect.gen(function* () {
      const cache = yield* CodeCache;
      const reads = yield* Ref.make<readonly string[]>([]);

      const read = (key: string, heavy: boolean) =>
        cache.through(
          key,
          Ref.update(reads, (all) => [...all, key]),
          { heavy }
        );

      yield* read("datekit:tree:t", false);
      yield* read("datekit:text:1", true);
      yield* read("datekit:text:2", true);
      yield* read("datekit:tree:t", false);
      yield* read("datekit:text:2", true);
      yield* read("datekit:text:1", true);

      expect(yield* Ref.get(reads)).toStrictEqual([
        "datekit:tree:t",
        "datekit:text:1",
        "datekit:text:2",
        "datekit:text:1",
      ]);
    }).pipe(Effect.provide(CodeCacheLive(2, 1)))
  );

  it.effect(
    "never make a caller wait on a read another caller left unfinished",
    () =>
      Effect.gen(function* () {
        // A Worker whose client goes away is cancelled where it stands: its
        // fibers are never interrupted, so a read it began never ends. The
        // isolate's next request for that key must read for itself (on
        // dev-oscabriel each such request hung, answering 1101).
        const cache = yield* CodeCache;

        yield* Effect.forkDetach(
          cache.through("burrow:text:abandoned", Effect.never)
        );

        yield* Effect.yieldNow;

        const next = yield* cache
          .through("burrow:text:abandoned", Effect.succeed("read"))
          .pipe(Effect.timeoutOption("1 second"), Effect.forkChild);

        yield* TestClock.adjust("1 second");

        expect(yield* Fiber.join(next)).toStrictEqual(Option.some("read"));
      }).pipe(Effect.provide(CodeCacheLive(10, 10)))
  );
});
