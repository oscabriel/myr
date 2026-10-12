import { describe, expect, it } from "@effect/vitest";
import { CommitSha, RepoPath } from "@repo/protocol/ids";
import { gitClient } from "@repo/testkit/git-client";
import { DateTime, Duration, Effect, Option, Redacted } from "effect";
import type { Layer } from "effect";
import { readCommit, writeCommit, writeTag } from "isomorphic-git";

import {
  BranchName,
  ObjectId,
  RefName,
  RefOutcome,
  RepoExists,
  RepoHost,
  RepoName,
  RepoNotFound,
  Revision,
} from "../src/repo-host.ts";
import type { Commit } from "../src/repo-host.ts";
import { memoryFs } from "../src/repo-host/memory-fs.ts";

const main = RefName.make("refs/heads/main");

const landed = RefName.make("refs/asked/landed");

const notes = RefName.make("refs/notes/commits");

const path = RepoPath.make("src/a.ts");

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const absent = ObjectId.make("0".repeat(40));

const authored = 1_700_000_000;

const committed = 1_700_000_500;

type Source = Parameters<RepoHost["Service"]["push"]>[1];

/** Written by hand, so its author and committer times differ (the test client stamps both alike). */
const timedCommit = (source: Source, parent: CommitSha) =>
  Effect.gen(function* () {
    const { commit } = yield* Effect.promise(() =>
      readCommit({ ...source, oid: parent })
    );

    const oid = yield* Effect.promise(() =>
      writeCommit({
        ...source,
        commit: {
          author: {
            email: "author@example.com",
            name: "Author",
            timestamp: authored,
            timezoneOffset: 0,
          },
          committer: {
            email: "committer@example.com",
            name: "Committer",
            timestamp: committed,
            timezoneOffset: -120,
          },
          message: "timed\n",
          parent: [parent],
          tree: commit.tree,
        },
      })
    );

    return CommitSha.make(oid);
  });

const times = (commit: Commit) => ({
  authoredAt: commit.authoredAt,
  committedAt: commit.committedAt,
});

const annotatedTag = (source: Source, name: string, commit: CommitSha) =>
  Effect.map(
    Effect.promise(() =>
      writeTag({
        ...source,
        tag: {
          message: `${name}\n`,
          object: commit,
          tag: name,
          tagger: {
            email: "tagger@example.com",
            name: "Tagger",
            timestamp: committed,
            timezoneOffset: 0,
          },
          type: "commit",
        },
      })
    ),
    // SAFETY: a tag's id is a 40-hex object id, which a ref update carries as a commit's.
    (oid) => CommitSha.make(oid)
  );

export interface RepoHostSuite {
  readonly importUrl?: (
    name: RepoName
  ) => Effect.Effect<string, never, RepoHost>;
  /**
   * Whether an import reads a remote made here whose HEAD names a branch it
   * lacks. Over smart HTTP such a remote advertises no HEAD, which
   * isomorphic-git cannot fetch at all, while a real remote whose default
   * is `master` advertises HEAD → master: `binding.test.ts` imports one.
   */
  readonly danglingHead?: boolean;
}

export const describeRepoHost = (
  adapter: string,
  host: Layer.Layer<RepoHost>,
  suite: RepoHostSuite = {}
) => {
  describe(`RepoHost over ${adapter}`, () => {
    // Ids from `git ls-tree` over the same files, so the store's ids are git's.
    it.effect("reads a tree's children and a blob's bytes by id", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient(memoryFs());

        const first = yield* client.commit("v1", [
          ["README.md", "demo"],
          ["src/a.ts", "v1"],
        ]);

        const second = yield* client.commit(
          "v2",
          [
            ["README.md", "demo"],
            ["src/a.ts", "v2"],
          ],
          [first]
        );

        const name = RepoName.make("trees");

        yield* repos.create(name);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: main, to: second },
        ]);

        const head = yield* repos.readCommit(name, second);

        expect(Option.map(head, (commit) => commit.tree)).toStrictEqual(
          Option.some(ObjectId.make("03b156b7030b730f4bf4987fc524acc760da5829"))
        );
        expect(
          yield* repos.readTree(
            name,
            ObjectId.make("03b156b7030b730f4bf4987fc524acc760da5829")
          )
        ).toStrictEqual(
          Option.some([
            {
              mode: "100644",
              name: "README.md",
              sha: ObjectId.make("efd261bf79519c997d1c2ac4154798d551f022dd"),
              type: "blob",
            },
            {
              mode: "040000",
              name: "src",
              sha: ObjectId.make("eed290426d7be6adc01ba5c60a2eef197acec06a"),
              type: "tree",
            },
          ])
        );
        expect(
          yield* repos.readTree(
            name,
            ObjectId.make("eed290426d7be6adc01ba5c60a2eef197acec06a")
          )
        ).toStrictEqual(
          Option.some([
            {
              mode: "100644",
              name: "a.ts",
              sha: ObjectId.make("8494ac27064713465d43ddea83398365ac0ba721"),
              type: "blob",
            },
          ])
        );
        expect(
          yield* repos
            .readBlob(
              name,
              ObjectId.make("8494ac27064713465d43ddea83398365ac0ba721")
            )
            .pipe(Effect.map(Option.map(text)))
        ).toStrictEqual(Option.some("v2"));
      }).pipe(Effect.provide(host))
    );

    it.effect("reads no tree and no blob at an id the repo lacks", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const name = RepoName.make("no-objects");

        yield* repos.create(name);

        expect(yield* repos.readTree(name, absent)).toStrictEqual(
          Option.none()
        );
        expect(yield* repos.readBlob(name, absent)).toStrictEqual(
          Option.none()
        );
      }).pipe(Effect.provide(host))
    );

    it.effect("names the repo it could not read a tree or a blob from", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const missing = RepoName.make("missing");

        expect(
          yield* Effect.flip(repos.readTree(missing, absent))
        ).toStrictEqual(new RepoNotFound({ name: missing }));
        expect(
          yield* Effect.flip(repos.readBlob(missing, absent))
        ).toStrictEqual(new RepoNotFound({ name: missing }));
      }).pipe(Effect.provide(host))
    );

    const { importUrl } = suite;

    if (importUrl !== undefined) {
      it.effect("imports a remote's default branch as a new repo", () =>
        Effect.gen(function* () {
          const repos = yield* RepoHost;
          const client = yield* gitClient(memoryFs());
          const first = yield* client.commit("first", [["a", "1"]]);
          const second = yield* client.commit("second", [["a", "2"]], [first]);
          const later = yield* client.commit("later", [["a", "3"]], [second]);
          const remote = RepoName.make("import-source");
          const name = RepoName.make("imported");

          yield* repos.create(remote);
          yield* repos.push(remote, client.source, [
            { from: Option.none(), ref: main, to: second },
          ]);

          const created = yield* repos.importFrom(name, {
            url: yield* importUrl(remote),
          });

          yield* repos.push(remote, client.source, [
            { from: Option.some(second), ref: main, to: later },
          ]);

          expect(created.name).toBe(name);
          expect(yield* repos.refs(name)).toStrictEqual(
            new Map([[main, second]])
          );
          expect(
            yield* repos.log(
              name,
              Revision.Branch({ name: BranchName.make("main") }),
              10
            )
          ).toMatchObject([{ sha: second }, { sha: first }]);
        }).pipe(Effect.provide(host))
      );

      if (suite.danglingHead === true) {
        // A remote whose default branch is `master`, as anyhow's and stb's are:
        // a store made here names `main` in its HEAD, so the import takes the
        // remote's one branch, and keeps its name, as Artifacts does.
        it.effect(
          "imports a remote whose only branch is master, under its own name",
          () =>
            Effect.gen(function* () {
              const repos = yield* RepoHost;
              const client = yield* gitClient(memoryFs());
              const first = yield* client.commit("first", [["a", "1"]]);
              const remote = RepoName.make("import-master");
              const name = RepoName.make("imported-master");
              const master = RefName.make("refs/heads/master");

              yield* repos.create(remote);
              yield* repos.push(remote, client.source, [
                { from: Option.none(), ref: master, to: first },
              ]);

              yield* repos.importFrom(name, { url: yield* importUrl(remote) });

              expect(yield* repos.refs(name)).toStrictEqual(
                new Map([[master, first]])
              );
            }).pipe(Effect.provide(host))
        );
      }

      it.effect("refuses to import over a repo that exists", () =>
        Effect.gen(function* () {
          const repos = yield* RepoHost;
          const remote = RepoName.make("import-remote");
          const taken = RepoName.make("import-taken");

          yield* repos.create(remote);
          yield* repos.create(taken);

          expect(
            yield* Effect.flip(
              repos.importFrom(taken, { url: yield* importUrl(remote) })
            )
          ).toStrictEqual(new RepoExists({ name: taken }));
        }).pipe(Effect.provide(host))
      );
    }

    it.effect("reads a file at a branch and at an older commit", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient(memoryFs());
        const first = yield* client.commit("v1", [["src/a.ts", "v1"]]);

        const second = yield* client.commit(
          "v2",
          [["src/a.ts", "v2"]],
          [first]
        );

        const name = RepoName.make("reads");

        yield* repos.create(name);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: main, to: second },
        ]);

        const at = (revision: Revision) =>
          repos
            .readFile(name, revision, path)
            .pipe(Effect.map(Option.map(text)));

        expect(
          yield* at(Revision.Branch({ name: BranchName.make("main") }))
        ).toStrictEqual(Option.some("v2"));
        expect(yield* at(Revision.Commit({ sha: first }))).toStrictEqual(
          Option.some("v1")
        );
        expect(
          yield* at(Revision.Branch({ name: BranchName.make("absent") }))
        ).toStrictEqual(Option.none());
      }).pipe(Effect.provide(host))
    );

    it.effect("logs first parents from a revision, newest first", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient(memoryFs());
        const first = yield* client.commit("first", [["a", "1"]]);
        const side = yield* client.commit("side", [["b", "1"]]);

        const merge = yield* client.commit(
          "merge",
          [["a", "2"]],
          [first, side]
        );

        const name = RepoName.make("history");

        yield* repos.create(name);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: main, to: merge },
        ]);

        const messages = (at: Revision, limit: number) =>
          repos
            .log(name, at, limit)
            .pipe(
              Effect.map((commits) => commits.map((commit) => commit.message))
            );

        const tip = Revision.Branch({ name: BranchName.make("main") });

        expect(yield* messages(tip, 10)).toStrictEqual(["merge", "first"]);
        expect(yield* messages(tip, 1)).toStrictEqual(["merge"]);
        expect(
          yield* messages(Revision.Commit({ sha: side }), 10)
        ).toStrictEqual(["side"]);
        expect(
          yield* messages(
            Revision.Branch({ name: BranchName.make("absent") }),
            10
          )
        ).toStrictEqual([]);
      }).pipe(Effect.provide(host))
    );

    it.effect("reads when a commit was written and when committed", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient(memoryFs());
        const first = yield* client.commit("first", [["a", "1"]]);
        const timed = yield* timedCommit(client.source, first);
        const name = RepoName.make("times");

        yield* repos.create(name);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: main, to: timed },
        ]);

        expect(
          Option.map(yield* repos.readCommit(name, timed), times)
        ).toStrictEqual(
          Option.some({ authoredAt: authored, committedAt: committed })
        );
        expect(
          (yield* repos.log(
            name,
            Revision.Branch({ name: BranchName.make("main") }),
            10
          )).map(times)
        ).toStrictEqual([
          { authoredAt: authored, committedAt: committed },
          { authoredAt: 1_791_300_000, committedAt: 1_791_300_000 },
        ]);
      }).pipe(Effect.provide(host))
    );

    it.effect("logs from an offset, skipping the newest commits", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient(memoryFs());
        const first = yield* client.commit("first", [["a", "1"]]);
        const second = yield* client.commit("second", [["a", "2"]], [first]);
        const third = yield* client.commit("third", [["a", "3"]], [second]);
        const name = RepoName.make("offsets");

        yield* repos.create(name);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: main, to: third },
        ]);

        const tip = Revision.Branch({ name: BranchName.make("main") });

        const shas = (limit: number, offset?: number) =>
          repos
            .log(name, tip, limit, offset)
            .pipe(Effect.map((commits) => commits.map(({ sha }) => sha)));

        expect(yield* shas(10, 1)).toStrictEqual([second, first]);
        expect(yield* shas(1, 1)).toStrictEqual([second]);
        expect(yield* shas(10, 3)).toStrictEqual([]);
        expect(yield* shas(10, 0)).toStrictEqual([third, second, first]);
      }).pipe(Effect.provide(host))
    );

    // An annotated tag names a tag object, which no commit read can read:
    // `tags` peels each to its commit, while `refs` keeps what git lists.
    it.effect("lists every tag peeled to its commit", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient(memoryFs());
        const first = yield* client.commit("first", [["a", "1"]]);
        const second = yield* client.commit("second", [["a", "2"]], [first]);
        const annotated = yield* annotatedTag(client.source, "v1.0.0", first);
        const name = RepoName.make("tagged");
        const v1 = RefName.make("refs/tags/v1.0.0");
        const light = RefName.make("refs/tags/light");

        yield* repos.create(name);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: main, to: second },
        ]);
        expect(yield* repos.tags(name)).toStrictEqual([]);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: v1, to: annotated },
        ]);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: light, to: second },
        ]);

        const tags = yield* repos.tags(name);

        expect(
          tags.toSorted((one, other) => one.name.localeCompare(other.name))
        ).toStrictEqual([
          { name: light, sha: second },
          { name: v1, sha: first },
        ]);
        expect((yield* repos.refs(name)).get(v1)).toBe(annotated);
        expect(
          yield* Effect.forEach(tags, ({ sha }) =>
            Effect.map(repos.readCommit(name, sha), Option.isSome)
          )
        ).toStrictEqual([true, true]);
        expect(
          yield* Effect.flip(repos.tags(RepoName.make("missing")))
        ).toStrictEqual(new RepoNotFound({ name: RepoName.make("missing") }));
      }).pipe(Effect.provide(host))
    );

    // Artifacts refuses `--atomic`, so landing pushes main by itself and
    // treats each ref's outcome on its own.
    it.effect("applies each ref's compare-and-swap on its own", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient(memoryFs());
        const first = yield* client.commit("first", [["a", "1"]]);
        const second = yield* client.commit("second", [["a", "2"]], [first]);
        const name = RepoName.make("compare-and-swap");

        yield* repos.create(name);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: main, to: first },
          { from: Option.none(), ref: landed, to: first },
        ]);

        const outcomes = yield* repos.push(name, client.source, [
          { from: Option.some(first), ref: main, to: second },
          { from: Option.some(second), ref: landed, to: second },
        ]);

        expect(outcomes).toStrictEqual([
          RefOutcome.Updated({ ref: main }),
          RefOutcome.Stale({ ref: landed, tip: Option.some(first) }),
        ]);
        expect(
          yield* repos.log(
            name,
            Revision.Branch({ name: BranchName.make("main") }),
            1
          )
        ).toMatchObject([{ sha: second }]);
      }).pipe(Effect.provide(host))
    );

    it.effect("refuses to create a ref that already exists", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient(memoryFs());
        const first = yield* client.commit("first", [["a", "1"]]);
        const other = yield* client.commit("other", [["a", "x"]]);
        const name = RepoName.make("create-only");

        yield* repos.create(name);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: main, to: first },
        ]);

        expect(
          yield* repos.push(name, client.source, [
            { from: Option.none(), ref: main, to: other },
          ])
        ).toStrictEqual([
          RefOutcome.Stale({ ref: main, tip: Option.some(first) }),
        ]);
      }).pipe(Effect.provide(host))
    );

    it.effect("keeps each fork's own commits to itself", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient(memoryFs());
        const first = yield* client.commit("first", [["a", "1"]]);
        const onlyA = yield* client.commit("only in a", [["a", "a"]], [first]);
        const base = RepoName.make("fork-base");
        const forkA = RepoName.make("fork-a");
        const forkB = RepoName.make("fork-b");

        yield* repos.create(base);
        yield* repos.push(base, client.source, [
          { from: Option.none(), ref: main, to: first },
        ]);
        yield* repos.fork(base, forkA);
        yield* repos.fork(base, forkB);
        yield* repos.push(forkA, client.source, [
          { from: Option.some(first), ref: main, to: onlyA },
        ]);

        const has = (name: RepoName, sha: typeof first) =>
          repos.readCommit(name, sha).pipe(Effect.map(Option.isSome));

        expect(yield* has(forkA, onlyA)).toBeTruthy();
        expect(yield* has(forkB, onlyA)).toBeFalsy();
        expect(yield* has(base, onlyA)).toBeFalsy();
        expect(yield* has(forkB, first)).toBeTruthy();
        expect(
          yield* repos.log(
            forkB,
            Revision.Branch({ name: BranchName.make("main") }),
            10
          )
        ).toMatchObject([{ sha: first }]);
      }).pipe(Effect.provide(host))
    );

    // Custom refs are kept and listed, but the binding's reads
    // resolve branch names only, so the platform reads them from this list.
    it.effect("lists custom refs that no read can name", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const client = yield* gitClient(memoryFs());
        const first = yield* client.commit("first", [["a", "1"]]);
        const name = RepoName.make("custom-refs");

        yield* repos.create(name);
        yield* repos.push(name, client.source, [
          { from: Option.none(), ref: main, to: first },
          { from: Option.none(), ref: landed, to: first },
          { from: Option.none(), ref: notes, to: first },
        ]);

        expect(yield* repos.refs(name)).toStrictEqual(
          new Map([
            [landed, first],
            [main, first],
            [notes, first],
          ])
        );
        expect(
          yield* repos.readFile(
            name,
            Revision.Branch({ name: BranchName.make("asked/landed") }),
            RepoPath.make("a")
          )
        ).toStrictEqual(Option.none());
      }).pipe(Effect.provide(host))
    );

    it.effect("names the repo it could not find or could not create", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const taken = RepoName.make("taken");
        const missing = RepoName.make("missing");

        yield* repos.create(taken);

        expect(yield* Effect.flip(repos.create(taken))).toStrictEqual(
          new RepoExists({ name: taken })
        );
        expect(yield* Effect.flip(repos.fork(missing, taken))).toStrictEqual(
          new RepoNotFound({ name: missing })
        );
        expect(yield* Effect.flip(repos.fork(taken, taken))).toStrictEqual(
          new RepoExists({ name: taken })
        );
        expect(yield* Effect.flip(repos.refs(missing))).toStrictEqual(
          new RepoNotFound({ name: missing })
        );
      }).pipe(Effect.provide(host))
    );

    it.effect(
      "mints a token that expires after its ttl, and revokes it once",
      () =>
        Effect.gen(function* () {
          const repos = yield* RepoHost;
          const name = RepoName.make("tokens");

          yield* repos.create(name);

          const now = yield* DateTime.now;
          const token = yield* repos.mintToken(name, "read", Duration.hours(1));

          expect(token.scope).toBe("read");
          expect(Redacted.value(token.secret)).not.toBe("");
          expect(token.expiresAt).toStrictEqual(
            DateTime.add(now, { hours: 1 })
          );
          expect(yield* repos.revokeToken(name, token.id)).toBeTruthy();
          expect(yield* repos.revokeToken(name, token.id)).toBeFalsy();
        }).pipe(Effect.provide(host))
    );

    it.effect("removes a repo once, freeing its name", () =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const name = RepoName.make("removed");

        yield* repos.create(name);
        expect(yield* repos.remote(name)).not.toBe("");
        expect(yield* repos.remove(name)).toBeTruthy();
        expect(yield* repos.remove(name)).toBeFalsy();
        expect(yield* Effect.flip(repos.remote(name))).toStrictEqual(
          new RepoNotFound({ name })
        );
        expect(
          yield* repos.refs((yield* repos.create(name)).name)
        ).toStrictEqual(new Map());
      }).pipe(Effect.provide(host))
    );
  });
};
