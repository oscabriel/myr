import { describe, expect, it } from "@effect/vitest";
import type { RepoName } from "@repo/protocol/ids";
import { CommitSha } from "@repo/protocol/ids";
import { Data, DateTime, Effect, Match, Option, Redacted } from "effect";

import {
  fakeArtifactsBinding,
  ObjectId,
} from "../src/fake-artifacts-binding.ts";
import type { HostLike } from "../src/fake-artifacts-binding.ts";

class RepoNotFound extends Data.TaggedError("RepoNotFound")<{
  readonly name: RepoName;
}> {}

class RepoExists extends Data.TaggedError("RepoExists")<{
  readonly name: RepoName;
}> {}

class ImportRefused extends Data.TaggedError("ImportRefused")<{
  readonly name: RepoName;
  readonly reason: string;
}> {}

/** What a promise of the binding threw. */
class Thrown extends Data.TaggedError("Thrown")<{ readonly error: Error }> {}

const commit = CommitSha.make("c".repeat(40));

const tree = ObjectId.make("d".repeat(40));

const subtree = ObjectId.make("e".repeat(40));

const blob = ObjectId.make("f".repeat(40));

const hello = new TextEncoder().encode("hello\n");

const answerer = { email: "answerer@example.com", name: "Answerer" };

/** The one commit every repo holds on `main`. */
const firstCommit = {
  author: answerer,
  authoredAt: 1_791_300_000,
  committedAt: 1_791_300_060,
  committer: answerer,
  message: "first",
  parents: [],
  sha: commit,
  tree,
};

/**
 * A repo host as small as the fake needs: every repo holds one commit on
 * `main`, whose tree has `a.txt` ("hello") and a folder `src`.
 */
const tinyHost = (): HostLike => {
  const repos = new Set<RepoName>();
  let minted = 0;

  const known = (name: RepoName): Effect.Effect<void, RepoNotFound> =>
    repos.has(name) ? Effect.void : Effect.fail(new RepoNotFound({ name }));

  const make = (name: RepoName) =>
    repos.has(name)
      ? Effect.fail(new RepoExists({ name }))
      : Effect.sync(() => {
          repos.add(name);

          return { name, remote: `memory://${name}.git` };
        });

  return {
    create: make,
    fork: (base, name) => known(base).pipe(Effect.andThen(make(name))),
    importFrom: (name, source) =>
      Effect.fail(
        new ImportRefused({ name, reason: `no repo at ${source.url}` })
      ),
    log: (name, at) =>
      known(name).pipe(
        Effect.as(
          Match.valueTags(at, {
            Branch: ({ name: branch }) => branch === "main",
            Commit: ({ sha }) => sha === commit,
          })
            ? [firstCommit]
            : []
        )
      ),
    mintToken: (name, scope, ttl) =>
      known(name).pipe(
        Effect.map(() => {
          minted += 1;

          return {
            expiresAt: DateTime.addDuration(
              DateTime.makeUnsafe("2026-10-07T12:00:00Z"),
              ttl
            ),
            id: `token-${minted}`,
            scope,
            secret: Redacted.make(`secret-${minted}`),
          };
        })
      ),
    readBlob: (name, sha) =>
      known(name).pipe(
        Effect.as(sha === blob ? Option.some(hello) : Option.none())
      ),
    readCommit: (name, sha) =>
      known(name).pipe(
        Effect.as(sha === commit ? Option.some(firstCommit) : Option.none())
      ),
    readFile: (name, at, path) =>
      known(name).pipe(
        Effect.as(
          Match.valueTags(at, {
            Branch: ({ name: branch }) => branch === "main",
            Commit: ({ sha }) => sha === commit,
          }) && path === "a.txt"
            ? Option.some(hello)
            : Option.none()
        )
      ),
    readTree: (name, sha) =>
      known(name).pipe(
        Effect.as(
          sha === tree
            ? Option.some([
                {
                  mode: "100644" as const,
                  name: "a.txt",
                  sha: blob,
                  type: "blob" as const,
                },
                {
                  mode: "040000" as const,
                  name: "src",
                  sha: subtree,
                  type: "tree" as const,
                },
              ])
            : Option.none()
        )
      ),
    remote: (name) => known(name).pipe(Effect.as(`memory://${name}.git`)),
    remove: (name) => Effect.sync(() => repos.delete(name)),
    revokeToken: (name) => known(name).pipe(Effect.as(true)),
  };
};

/** Awaits one of the binding's promises. */
const call = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (error) =>
      new Thrown({
        error: error instanceof Error ? error : new Error(String(error)),
      }),
    try: run,
  });

/** What one of the binding's promises threw, or an error saying it resolved. */
const thrown = <A>(run: () => Promise<A>) =>
  call(run).pipe(
    Effect.match({
      onFailure: ({ error }) => error,
      onSuccess: (value) => new Error(`resolved with ${String(value)}`),
    })
  );

const text = (bytes: Blob | null) =>
  bytes === null ? Effect.succeed(null) : call(() => bytes.text());

/** An error as a plain record: its name and message, and its code and number if it has them. */
const described = (error: Error) => ({
  code: "code" in error ? error.code : undefined,
  isError: error instanceof Error,
  message: error.message,
  name: error.name,
  numericCode: "numericCode" in error ? error.numericCode : undefined,
});

/** A binding over a fresh tiny host, with `datekit` made, and the repo `get` hands back. */
const withDatekit = (
  options: Parameters<typeof fakeArtifactsBinding>[1] = {}
) =>
  Effect.gen(function* () {
    const binding = fakeArtifactsBinding(tinyHost(), options);
    const created = yield* call(() => binding.create("datekit"));
    const repo = yield* call(() => binding.get("datekit"));

    return { binding, created, repo };
  });

describe("the fake Artifacts binding", () => {
  it.effect("creates a repo with a remote and a write token", () =>
    Effect.gen(function* () {
      const { created } = yield* withDatekit();

      expect(created).toMatchObject({
        defaultBranch: "main",
        description: null,
        name: "datekit",
        remote: "memory://datekit.git",
        token: "secret-1",
      });
    })
  );

  it.effect("hands back a repo whose reads by object id go to the host", () =>
    Effect.gen(function* () {
      const { repo } = yield* withDatekit();

      expect(yield* call(() => repo.readTree(tree))).toStrictEqual([
        { hash: blob, mode: "100644", name: "a.txt", type: "blob" },
        { hash: subtree, mode: "40000", name: "src", type: "tree" },
      ]);
      expect(yield* text(yield* call(() => repo.readBlob(blob)))).toBe(
        "hello\n"
      );
      expect(yield* call(() => repo.readCommit(commit))).toStrictEqual({
        author: answerer,
        authoredAt: 1_791_300_000,
        committedAt: 1_791_300_060,
        committer: answerer,
        hash: commit,
        message: "first",
        parents: [],
        treeHash: tree,
      });
    })
  );

  it.effect("reads null for an object the host doesn't have", () =>
    Effect.gen(function* () {
      const { repo } = yield* withDatekit();

      expect(yield* call(() => repo.readTree(subtree))).toBeNull();
      expect(yield* call(() => repo.readBlob(tree))).toBeNull();
      expect(yield* call(() => repo.readCommit(blob))).toBeNull();
    })
  );

  it.effect(
    "throws NOT_FOUND, as an ArtifactsError, for a repo it doesn't have",
    () =>
      Effect.gen(function* () {
        const error = yield* thrown(() =>
          fakeArtifactsBinding(tinyHost()).get("nobody")
        );

        expect(described(error)).toStrictEqual({
          code: "NOT_FOUND",
          isError: true,
          message: "Repository not found: nobody",
          name: "ArtifactsError",
          numericCode: 0,
        });
      })
  );

  it.effect(
    "throws plain Errors with no code when codeless, as wrangler dev's remote bindings do (S1 #22)",
    () =>
      Effect.gen(function* () {
        const { binding } = yield* withDatekit({ codeless: true });
        const missing = yield* thrown(() => binding.get("nobody"));
        const again = yield* thrown(() => binding.create("datekit"));

        expect(described(missing)).toStrictEqual({
          code: undefined,
          isError: true,
          message: "ArtifactsError: Repository not found: nobody",
          name: "Error",
          numericCode: undefined,
        });
        expect(described(again)).toMatchObject({
          code: undefined,
          message: "ArtifactsError: repo already exists: datekit",
        });
      })
  );

  it.effect(
    "answers a fork under load with a 500 after making it, then a 409 on the retry (S7)",
    () =>
      Effect.gen(function* () {
        const { binding, repo } = yield* withDatekit({ forkFailures: 1 });
        const first = yield* thrown(() => repo.fork("datekit--fix--bob"));
        const made = yield* call(() => binding.get("datekit--fix--bob"));
        const retry = yield* thrown(() => repo.fork("datekit--fix--bob"));
        const next = yield* call(() => repo.fork("datekit--fix--carol"));

        expect(described(first)).toStrictEqual({
          code: "INTERNAL_ERROR",
          isError: true,
          message: "An internal error occurred.",
          name: "ArtifactsError",
          numericCode: 10_400,
        });
        // The fork was made all the same.
        expect(yield* text(yield* call(() => made.readBlob(blob)))).toBe(
          "hello\n"
        );
        expect(described(retry)).toStrictEqual({
          code: "ALREADY_EXISTS",
          isError: true,
          message: "repo already exists: datekit--fix--bob",
          name: "ArtifactsError",
          numericCode: 10_201,
        });
        expect(next).toMatchObject({ name: "datekit--fix--carol" });
      })
  );

  it.effect(
    "resolves only short branch names and commit ids in reads by ref (S1 #20)",
    () =>
      Effect.gen(function* () {
        const { repo } = yield* withDatekit();

        const read = (ref: string) =>
          call(() => repo.readFile({ path: "a.txt", ref })).pipe(
            Effect.flatMap(text)
          );

        expect(yield* read("refs/heads/main")).toBeNull();
        expect(yield* read("asked/landed")).toBeNull();
        expect([yield* read("main"), yield* read(commit)]).toStrictEqual([
          "hello\n",
          "hello\n",
        ]);
        expect(
          yield* call(() => repo.log({ ref: "refs/heads/main" }))
        ).toStrictEqual([]);
        expect(
          (yield* call(() => repo.log())).map(({ hash }) => hash)
        ).toStrictEqual([commit]);
      })
  );

  it.effect("refuses a malformed object id, an empty path or a bad name", () =>
    Effect.gen(function* () {
      const { binding, repo } = yield* withDatekit();

      const codes = [
        yield* thrown(() => repo.readTree("HEAD")),
        yield* thrown(() => repo.readFile({ path: "", ref: "main" })),
        yield* thrown(() => binding.create("no spaces")),
        yield* thrown(() => repo.createToken("read", 59)),
      ].map((error) => described(error).code);

      expect(codes).toStrictEqual([
        "INVALID_INPUT",
        "INVALID_INPUT",
        "INVALID_REPO_NAME",
        "INVALID_TTL",
      ]);
    })
  );

  it.effect(
    "serves remotes under a base URL, for a git server the test runs",
    () =>
      Effect.gen(function* () {
        const { created, repo } = yield* withDatekit({
          remoteBase: "http://127.0.0.1:9000/git",
        });

        const info = yield* call(() => repo.info());

        expect(created.remote).toBe("http://127.0.0.1:9000/git/datekit.git");
        expect(info).toMatchObject({
          defaultBranch: "main",
          lastPushAt: null,
          name: "datekit",
          remote: "http://127.0.0.1:9000/git/datekit.git",
          source: null,
        });
      })
  );

  it.effect("mints, lists and revokes tokens through the host", () =>
    Effect.gen(function* () {
      const { repo } = yield* withDatekit();
      const token = yield* call(() => repo.createToken("read", 60));
      const revoked = yield* call(() => repo.revokeToken("secret-2"));
      const { tokens } = yield* call(() => repo.listTokens());

      expect(token).toStrictEqual({
        expiresAt: "2026-10-07T12:01:00.000Z",
        id: "token-2",
        plaintext: "secret-2",
        scope: "read",
      });
      expect(revoked).toBeTruthy();
      expect(tokens.map(({ id, state }) => [id, state])).toStrictEqual([
        ["token-1", "active"],
        ["token-2", "revoked"],
      ]);
    })
  );

  it.effect("lists and deletes what it made", () =>
    Effect.gen(function* () {
      const { binding } = yield* withDatekit();

      yield* call(() => binding.create("burrow"));

      const listed = yield* call(() => binding.list());
      const deleted = yield* call(() => binding.delete("datekit"));
      const again = yield* call(() => binding.delete("datekit"));
      const gone = yield* thrown(() => binding.get("datekit"));

      expect(listed).toMatchObject({ total: 2 });
      expect(listed.repos.map(({ name }) => name)).toStrictEqual([
        "datekit",
        "burrow",
      ]);
      expect([deleted, again]).toStrictEqual([true, false]);
      expect(described(gone).code).toBe("NOT_FOUND");
    })
  );

  it.effect("reports a repo made read-only as read-only", () =>
    Effect.gen(function* () {
      const { binding, repo } = yield* withDatekit();

      yield* call(() => binding.create("archive", { readOnly: true }));
      yield* call(() => repo.fork("datekit--mirror", { readOnly: true }));

      const { repos } = yield* call(() => binding.list());

      expect(repos.map(({ name, readOnly }) => [name, readOnly])).toStrictEqual(
        [
          ["datekit", false],
          ["archive", true],
          ["datekit--mirror", true],
        ]
      );
    })
  );

  it.effect(
    "lists nothing it deleted, even after a stale handle reads the repo",
    () =>
      Effect.gen(function* () {
        const { binding, repo } = yield* withDatekit();

        yield* call(() => binding.delete("datekit"));

        const codes = [
          yield* thrown(() => repo.info()),
          yield* thrown(() => repo.log()),
          yield* thrown(() => repo.revokeToken("secret-1")),
          yield* thrown(() => repo.listTokens()),
        ].map((error) => described(error).code);

        expect(codes).toStrictEqual([
          "NOT_FOUND",
          "NOT_FOUND",
          "NOT_FOUND",
          "NOT_FOUND",
        ]);
        expect(yield* call(() => binding.list())).toStrictEqual({
          repos: [],
          total: 0,
        });
      })
  );
});
