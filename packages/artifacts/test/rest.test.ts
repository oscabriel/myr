import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { RepoPath } from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import { gitClient } from "@repo/testkit/git-client";
import { httpBackend } from "@repo/testkit/http-backend";
import {
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
} from "effect";
import type { Scope } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { readCommit } from "isomorphic-git";

import { Fetch, FetchFailed } from "../src/fetch.ts";
import {
  BranchName,
  ForkInProgress,
  ImportRefused,
  ObjectId,
  RefName,
  RepoHost,
  RepoName,
  RepoNotFound,
  Revision,
} from "../src/repo-host.ts";
import type { PushSource } from "../src/repo-host.ts";
import { RepoHostLocal } from "../src/repo-host/local.ts";
import { memoryFs } from "../src/repo-host/memory-fs.ts";
import { RepoHostRest } from "../src/repo-host/rest.ts";
import { fakeRest } from "./fake-rest.ts";
import type { FakeRestOptions } from "./fake-rest.ts";
import { describeRepoHost } from "./repo-host-contract.ts";

const main = RefName.make("refs/heads/main");

const accountId = "0123456789abcdef0123456789abcdef";

const namespace = "projects-test";

const api = `https://api.cloudflare.com/client/v4/accounts/${accountId}/artifacts/namespaces/${namespace}`;

/** Where the store's repos are served, in Artifacts' shape: `<base>/<name>.git`. */
const remoteBase = `https://${accountId}.artifacts.test/git/${namespace}`;

const apiToken = "cf-api-token-for-the-rest-tests";

/** One request as the test's `Fetch` saw it, with its reply. */
interface Seen {
  readonly method: string;
  readonly url: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
  readonly status: number;
  readonly reply: string;
}

const textOf = (message: Request | Response) =>
  Effect.promise(() => message.clone().arrayBuffer()).pipe(
    Effect.map((buffer) => new TextDecoder().decode(buffer))
  );

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

/** What a token's mint answered, as far as these tests read it. */
const decodeMinted = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      result: Schema.Struct({ id: Schema.String, plaintext: Schema.String }),
    })
  )
);

/**
 * The REST adapter over a fake API on local disk: a `RepoHostLocal` in a
 * temporary directory, behind `fakeRest`, with its remotes served by real
 * `git http-backend` over the same directory. Every request and reply the
 * adapter's `Fetch` carries is recorded.
 */
const world = (
  options: Omit<FakeRestOptions, "accountId" | "namespace" | "token"> = {}
) =>
  Effect.gen(function* () {
    const root = yield* RepoHostLocal.temporaryRoot;

    const spawner =
      yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();

    const backend = httpBackend(root);
    const seen = yield* Ref.make<readonly Seen[]>([]);

    const git = (request: Request) =>
      Effect.scoped(backend(request)).pipe(Effect.provide(spawner));

    const store = yield* RepoHost.pipe(
      Effect.provide(
        RepoHostLocal.layer({ remoteBase, root }).pipe(
          Layer.provide(Layer.succeed(Fetch, Fetch.of({ fetch: git })))
        )
      )
    );

    const serve = yield* fakeRest(store, {
      ...options,
      accountId,
      namespace,
      token: apiToken,
    });

    const route = (request: Request) => {
      if (request.url.startsWith(`${api}/`)) {
        return serve(request);
      }

      if (request.url.startsWith(`${remoteBase}/`)) {
        return git(request);
      }

      return Effect.fail(
        new FetchFailed({ reason: "no route to host", url: request.url })
      );
    };

    const fetch = Fetch.of({
      fetch: (request) =>
        Effect.gen(function* () {
          const body = yield* textOf(request);
          const response = yield* route(request);
          const reply = yield* textOf(response);

          yield* Ref.update(seen, (all) => [
            ...all,
            {
              body,
              headers: [...request.headers.entries()],
              method: request.method,
              reply,
              status: response.status,
              url: request.url,
            },
          ]);

          return response;
        }),
    });

    return {
      layer: RepoHostRest.layer({
        accountId,
        namespace,
        token: Redacted.make(apiToken),
      }).pipe(Layer.provide(Layer.succeed(Fetch, fetch))),
      seen,
      store,
    };
  });

type World = Effect.Success<ReturnType<typeof world>>;

/** A test body over a fresh world, with the REST adapter's `RepoHost` in scope. */
const within = <A, E>(
  body: (
    world: World
  ) => Effect.Effect<
    A,
    E,
    RepoHost | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
  >,
  options?: Parameters<typeof world>[0]
) =>
  Effect.gen(function* () {
    const made = yield* world(options);

    return yield* body(made).pipe(Effect.provide(made.layer));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describeRepoHost(
  "rest",
  Layer.unwrap(Effect.map(world(), ({ layer }) => layer)).pipe(
    Layer.provide(NodeServices.layer)
  ),
  {
    importUrl: (name) =>
      RepoHost.use((repos) => repos.remote(name)).pipe(Effect.orDie),
  }
);

/** A repo `name` with one commit on `main`, and the client that made it. */
const seeded = (name: RepoName) =>
  Effect.gen(function* () {
    const repos = yield* RepoHost;
    const client = yield* gitClient(memoryFs());
    const first = yield* client.commit("first", [["a.txt", "1"]]);

    yield* repos.create(name).pipe(Effect.orDie);
    yield* repos
      .push(name, client.source, [
        { from: Option.none(), ref: main, to: first },
      ])
      .pipe(Effect.orDie);

    return { client, first };
  });

/** The requests to one REST route, by method and path under the namespace. */
const requestsTo = (
  seen: Ref.Ref<readonly Seen[]>,
  method: string,
  path: string
) =>
  Ref.get(seen).pipe(
    Effect.map((all) =>
      all.filter(
        (request) =>
          request.method === method && request.url === `${api}${path}`
      )
    )
  );

/** A commit's tree, read from the client that wrote it. */
const treeOf = (source: PushSource, oid: CommitSha) =>
  Effect.promise(() => readCommit({ ...source, oid })).pipe(
    Effect.map(({ commit }) => ObjectId.make(commit.tree))
  );

const authorizationOf = ({ headers }: Seen) =>
  headers.find(([name]) => name === "authorization")?.[1] ?? "";

describe("forks over REST, which name their target", () => {
  // cf's schema has no `name` for a fork (cf #180); the REST API takes one.
  it.live("forks the default branch only, to the name it was given", () =>
    within(({ seen }) =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const base = RepoName.make("demo");
        const name = RepoName.make("demo--fix--alice");
        const { first } = yield* seeded(base);
        const created = yield* repos.fork(base, name).pipe(Effect.orDie);
        const forks = yield* requestsTo(seen, "POST", `/repos/${base}/fork`);

        expect(created).toStrictEqual({
          name,
          remote: `${remoteBase}/${name}.git`,
        });
        expect(
          yield* Effect.forEach(forks, ({ body }) => decodeJson(body))
        ).toStrictEqual([{ default_branch_only: true, name }]);
        expect(yield* repos.refs(name).pipe(Effect.orDie)).toStrictEqual(
          new Map([[main, first]])
        );
      })
    )
  );

  // S7 #2: under load a fork answers 500 (code 10400) after making the repo,
  // and a retry answers 409 (code 10201), or 500 again.
  it.live.each([
    { failures: 1, retry: "an already-exists" },
    { failures: 2, retry: "a second 500" },
  ])(
    "makes one fork through a 500 with code 10400 and then $retry",
    ({ failures }) =>
      within(
        ({ seen, store }) =>
          Effect.gen(function* () {
            const repos = yield* RepoHost;
            const base = RepoName.make("demo");
            const name = RepoName.make("demo--fix--bob");
            const { first } = yield* seeded(base);
            const created = yield* repos.fork(base, name).pipe(Effect.orDie);

            const forks = yield* requestsTo(
              seen,
              "POST",
              `/repos/${base}/fork`
            );

            expect(created).toStrictEqual({
              name,
              remote: `${remoteBase}/${name}.git`,
            });
            expect(forks.map(({ status }) => status)).toStrictEqual(
              failures === 1 ? [500, 409] : [500, 500]
            );
            expect(
              yield* Effect.forEach(forks.slice(0, 1), ({ reply }) =>
                decodeJson(reply)
              )
            ).toMatchObject([{ errors: [{ code: 10_400 }], success: false }]);
            expect(yield* store.refs(name).pipe(Effect.orDie)).toStrictEqual(
              new Map([[main, first]])
            );
          }),
        { forkFailures: failures }
      )
  );

  it.live("reads a fork that two 500s left unmade as ForkInProgress", () =>
    within(
      ({ seen, store }) =>
        Effect.gen(function* () {
          const repos = yield* RepoHost;
          const base = RepoName.make("demo");
          const name = RepoName.make("demo--fix--carol");

          yield* seeded(base);

          expect(yield* Effect.flip(repos.fork(base, name))).toStrictEqual(
            new ForkInProgress({ name })
          );
          expect(
            yield* requestsTo(seen, "POST", `/repos/${base}/fork`)
          ).toHaveLength(2);
          expect(yield* Effect.flip(store.remote(name))).toStrictEqual(
            new RepoNotFound({ name })
          );
        }),
      { forkFailures: 2, forkLost: true }
    )
  );
});

describe("the tokens the REST adapter carries", () => {
  it.live(
    "sends the API token to the API and repo tokens to git, each only as Authorization: Bearer",
    () =>
      within(({ seen }) =>
        Effect.gen(function* () {
          const repos = yield* RepoHost;
          const name = RepoName.make("tokens");
          const at = Revision.Branch({ name: BranchName.make("main") });
          const { client, first } = yield* seeded(name);

          const second = yield* client.commit(
            "second",
            [["a.txt", "2"]],
            [first]
          );

          yield* repos
            .push(name, client.source, [
              { from: Option.some(first), ref: main, to: second },
            ])
            .pipe(Effect.orDie);
          yield* repos.refs(name).pipe(Effect.orDie);
          yield* repos.readFile(name, at, RepoPath.make("a.txt"));
          yield* repos.log(name, at, 5);
          yield* repos.fork(name, RepoName.make("tokens--fork"));

          const minted = yield* repos.mintToken(
            name,
            "read",
            Duration.minutes(5)
          );

          yield* repos.revokeToken(name, minted.id);

          const requests = yield* Ref.get(seen);
          const toApi = requests.filter(({ url }) => url.startsWith(api));

          const toGit = requests.filter(({ url }) =>
            url.startsWith(remoteBase)
          );

          const repoTokens = yield* Effect.forEach(
            yield* requestsTo(seen, "POST", "/tokens"),
            ({ reply }) =>
              decodeMinted(reply).pipe(
                Effect.map(({ result }) => result.plaintext)
              )
          );

          const secrets = [apiToken, ...repoTokens];

          const leaks = requests.flatMap(({ body, headers, url }) =>
            secrets.filter(
              (secret) =>
                url.includes(secret) ||
                body.includes(secret) ||
                headers.some(
                  ([header, value]) =>
                    header !== "authorization" && value.includes(secret)
                )
            )
          );

          expect(new Set(toApi.map(authorizationOf))).toStrictEqual(
            new Set([`Bearer ${apiToken}`])
          );
          expect(toGit).not.toHaveLength(0);
          expect(
            toGit.filter(
              (request) =>
                !repoTokens
                  .map((token) => `Bearer ${token}`)
                  .includes(authorizationOf(request))
            )
          ).toStrictEqual([]);
          expect(leaks).toStrictEqual([]);
        })
      )
  );

  it.live(
    "revokes the tokens it minted for its own git calls when it closes",
    () =>
      Effect.gen(function* () {
        const made = yield* world();
        const name = RepoName.make("closing");

        yield* Effect.gen(function* () {
          const repos = yield* RepoHost;
          const { client, first } = yield* seeded(name);

          const second = yield* client.commit(
            "second",
            [["a.txt", "2"]],
            [first]
          );

          yield* repos
            .push(name, client.source, [
              { from: Option.some(first), ref: main, to: second },
            ])
            .pipe(Effect.orDie);
          yield* repos.refs(name).pipe(Effect.orDie);
        }).pipe(Effect.provide(made.layer));

        const used = new Set(
          (yield* Ref.get(made.seen))
            .filter(({ url }) => url.startsWith(remoteBase))
            .map(authorizationOf)
        );

        const ids = yield* Effect.forEach(
          yield* requestsTo(made.seen, "POST", "/tokens"),
          ({ reply }) => decodeMinted(reply)
        ).pipe(
          Effect.map((all) =>
            all
              .filter(({ result }) => used.has(`Bearer ${result.plaintext}`))
              .map(({ result }) => result.id)
          )
        );

        const revoked = yield* Effect.forEach(ids, (id) =>
          requestsTo(made.seen, "DELETE", `/tokens/${id}`)
        );

        const live = yield* Effect.forEach(ids, (id) =>
          made.store.revokeToken(name, id).pipe(Effect.orDie)
        );

        expect(ids).toHaveLength(2);
        expect(ids).toHaveLength(used.size);
        expect(revoked.map((requests) => requests.length)).toStrictEqual([
          1, 1,
        ]);
        expect(live).toStrictEqual([false, false]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  // cf's help for `tokens revoke`: ids resolve through an eventually
  // consistent index, so a revocation within about a second of the mint can
  // be 404.
  it.live("tries a revocation again when the token index lags its mint", () =>
    within(
      ({ seen }) =>
        Effect.gen(function* () {
          const repos = yield* RepoHost;
          const name = RepoName.make("lagging");

          yield* repos.create(name).pipe(Effect.orDie);

          const token = yield* repos
            .mintToken(name, "read", Duration.minutes(5))
            .pipe(Effect.orDie);

          expect(
            yield* repos.revokeToken(name, token.id).pipe(Effect.orDie)
          ).toBeTruthy();
          expect(
            yield* requestsTo(seen, "DELETE", `/tokens/${token.id}`)
          ).toHaveLength(2);
          expect(
            yield* repos.revokeToken(name, token.id).pipe(Effect.orDie)
          ).toBeFalsy();
        }),
      { revokeLag: 1 }
    )
  );
});

describe("Artifacts' error codes, read as the port's errors", () => {
  // 10104 is "the source URL does not point to a valid git repository", and
  // 10200 "the repository or remote resource does not exist" (errors page).
  it.live("refuses an import from no repo, and a token for no repo", () =>
    within(() =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const name = RepoName.make("imported");
        const missing = RepoName.make("missing");
        const url = "file:///nowhere/at/all.git";

        expect(
          yield* Effect.flip(repos.importFrom(name, { url }))
        ).toStrictEqual(
          new ImportRefused({ name, reason: `no repo at ${url}` })
        );
        expect(
          yield* Effect.flip(
            repos.mintToken(missing, "read", Duration.minutes(5))
          )
        ).toStrictEqual(new RepoNotFound({ name: missing }));
      })
    )
  );
});

describe("reads whose replies the REST docs do not show", () => {
  it.live.each([{ casing: "snake" as const }, { casing: "camel" as const }])(
    "reads a commit and a log whose metadata is in $casing case",
    ({ casing }) =>
      within(
        () =>
          Effect.gen(function* () {
            const repos = yield* RepoHost;
            const name = RepoName.make("metadata");
            const { client, first } = yield* seeded(name);
            const written = yield* treeOf(client.source, first);

            const commit = yield* repos
              .readCommit(name, first)
              .pipe(Effect.orDie);

            expect(commit).toStrictEqual(
              Option.some({
                author: { email: "answerer@example.com", name: "Answerer" },
                committer: { email: "answerer@example.com", name: "Answerer" },
                message: "first",
                parents: [],
                sha: first,
                tree: written,
              })
            );
            expect(
              yield* repos
                .log(name, Revision.Commit({ sha: first }), 10)
                .pipe(Effect.orDie)
            ).toStrictEqual(Option.toArray(commit));
          }),
        { casing }
      )
  );

  // The binding throws `INTERNAL_ERROR` for a read of the wrong kind; the
  // fake's REST API answers 500 there (an ASSUMPTION), and the other stores
  // read no tree (202 Comment 5).
  it.live("reads no tree at a blob's id or a commit's id", () =>
    within(() =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const name = RepoName.make("kinds");
        const { client, first } = yield* seeded(name);
        const tree = yield* treeOf(client.source, first);
        const entries = yield* repos.readTree(name, tree).pipe(Effect.orDie);
        const blob = Option.getOrThrow(entries)[0]?.sha ?? tree;

        expect(blob).not.toBe(tree);
        expect(yield* Effect.exit(repos.readTree(name, blob))).toStrictEqual(
          Exit.succeed(Option.none())
        );
        expect(
          yield* Effect.exit(repos.readTree(name, ObjectId.make(first)))
        ).toStrictEqual(Exit.succeed(Option.none()));
      })
    )
  );
});
