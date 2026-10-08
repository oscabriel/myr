import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { CommitSha, RepoPath } from "@repo/protocol/ids";
import { fakeArtifactsBinding } from "@repo/testkit/fake-artifacts-binding";
import type {
  FakeOptions,
  HostLike,
} from "@repo/testkit/fake-artifacts-binding";
import { gitClient } from "@repo/testkit/git-client";
import { httpBackend } from "@repo/testkit/http-backend";
import {
  Duration,
  Effect,
  Exit,
  FiberSet,
  Layer,
  Option,
  Redacted,
  Ref,
} from "effect";
import type { Scope } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { readCommit } from "isomorphic-git";

import { Fetch, FetchFailed } from "../src/fetch.ts";
import {
  BranchName,
  ForkInProgress,
  HostBusy,
  ObjectId,
  RefName,
  RefOutcome,
  RepoExists,
  RepoHost,
  RepoName,
  RepoNotFound,
  Revision,
} from "../src/repo-host.ts";
import { RepoHostBinding } from "../src/repo-host/binding.ts";
import { RepoHostLocal } from "../src/repo-host/local.ts";
import { memoryFs } from "../src/repo-host/memory-fs.ts";
import { fetchInto, listRefs, pushRefs } from "../src/repo-host/smart-http.ts";
import { describeRepoHost } from "./repo-host-contract.ts";
import { temporaryRoot } from "./temporary-root.ts";

const main = RefName.make("refs/heads/main");

const landed = RefName.make("refs/asked/landed");

/** Where the store's repos are served, in Artifacts' shape: `<base>/<name>.git`. */
const remoteBase = "https://artifacts.test/git/projects";

/** A packet-line holding one side-band 3 (fatal) message. */
const fatal = (message: string) => {
  const payload = new TextEncoder().encode(`\u0003${message}`);
  const length = (payload.length + 4).toString(16).padStart(4, "0");

  return new Uint8Array([...new TextEncoder().encode(length), ...payload]);
};

/** Artifacts' whole reply to a push it is too busy for: no report, no flush. */
const busyReply = () =>
  new Response(fatal("artifacts_git_receive_pack_busy\n"), {
    headers: { "content-type": "application/x-git-receive-pack-result" },
  });

/** What one request to the store carried, as the test's `Fetch` saw it. */
interface Seen {
  readonly url: string;
  readonly authorization: string | null;
}

/** What a test may do to the next receive-pack call before git sees it. */
type Intercept = (request: Request) => Effect.Effect<Option.Option<Response>>;

/**
 * The binding over a fake Artifacts on local disk: a `RepoHostLocal` in a
 * temporary directory, wrapped by testkit's fake binding, whose remotes a
 * `Fetch` serves with real `git http-backend` over the same directory.
 * Every handle the binding opens is counted, and every token it mints is
 * recorded, so a test can check both came back.
 */
const world = (
  options: FakeOptions & {
    readonly wrap?: (host: HostLike) => HostLike;
    /** How many of the first `get`s answer that the repo is still being made, and how. */
    readonly making?: {
      readonly code: "CREATE_IN_PROGRESS" | "IMPORT_IN_PROGRESS";
      readonly gets: number;
    };
  } = {}
) =>
  Effect.gen(function* () {
    const root = yield* temporaryRoot;

    const spawner =
      yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();

    const backend = httpBackend(root);
    const seen = yield* Ref.make<readonly Seen[]>([]);
    const intercept = yield* Ref.make<Option.Option<Intercept>>(Option.none());

    const fetch = Fetch.of({
      fetch: (request) =>
        Effect.gen(function* () {
          if (!request.url.startsWith(`${remoteBase}/`)) {
            return yield* new FetchFailed({
              reason: "no route to host",
              url: request.url,
            });
          }

          yield* Ref.update(seen, (all) => [
            ...all,
            {
              authorization: request.headers.get("authorization"),
              url: request.url,
            },
          ]);

          const once = yield* Ref.getAndSet(intercept, Option.none());

          if (
            Option.isSome(once) &&
            request.url.endsWith("/git-receive-pack")
          ) {
            const reply = yield* once.value(request);

            if (Option.isSome(reply)) {
              return reply.value;
            }
          } else if (Option.isSome(once)) {
            yield* Ref.set(intercept, once);
          }

          return yield* Effect.scoped(backend(request)).pipe(
            Effect.provide(spawner)
          );
        }),
    });

    const store = yield* RepoHost.pipe(
      Effect.provide(
        RepoHostLocal.layer({ remoteBase, root }).pipe(
          Layer.provide(Layer.succeed(Fetch, fetch))
        )
      )
    );

    const fake = fakeArtifactsBinding(
      options.wrap === undefined ? store : options.wrap(store),
      options
    );

    // The fake's handles dispose as a no-op; this wrapper counts each handle
    // `get` gave out against the disposals, and keeps each token minted.
    const run = yield* FiberSet.makeRuntimePromise();
    const counts = { disposed: 0, gets: 0 };
    const tokens: { id: string; plaintext: string }[] = [];
    let making = options.making?.gets ?? 0;

    const binding: Artifacts = {
      ...fake,
      get: (name) => {
        if (making > 0 && options.making !== undefined) {
          making -= 1;

          return Promise.reject(
            Object.assign(new Error("the repo is still being made"), {
              code: options.making.code,
            })
          );
        }

        return run(
          Effect.promise(() => fake.get(name)).pipe(
            Effect.map((repo): ArtifactsRepo => {
              counts.gets += 1;

              return {
                ...repo,
                createToken: (scope, ttl) =>
                  run(
                    Effect.promise(() => repo.createToken(scope, ttl)).pipe(
                      Effect.tap((token) =>
                        Effect.sync(() => tokens.push(token))
                      )
                    )
                  ),
                [Symbol.dispose]: () => {
                  counts.disposed += 1;
                  repo[Symbol.dispose]();
                },
              };
            })
          )
        );
      },
    };

    return {
      binding,
      counts,
      fake,
      fetch,
      intercept,
      layer: RepoHostBinding.layer(binding).pipe(
        Layer.provide(Layer.succeed(Fetch, fetch))
      ),
      seen,
      store,
      tokens,
    };
  });

type World = Effect.Success<ReturnType<typeof world>>;

/** A test body over a fresh world, with the binding's `RepoHost` in scope. */
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
  "binding",
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

describe("the Workers binding's surprises, typed", () => {
  // Under `wrangler dev`, the binding throws plain `Error`s.
  it.live(
    "reads a missing repo as RepoNotFound when errors carry no code",
    () =>
      within(
        () =>
          Effect.gen(function* () {
            const repos = yield* RepoHost;
            const missing = RepoName.make("missing");
            const taken = RepoName.make("taken");

            yield* repos.create(taken).pipe(Effect.orDie);

            expect(
              yield* Effect.flip(
                repos.readFile(
                  missing,
                  Revision.Branch({ name: BranchName.make("main") }),
                  RepoPath.make("a.txt")
                )
              )
            ).toStrictEqual(new RepoNotFound({ name: missing }));
            expect(yield* Effect.flip(repos.refs(missing))).toStrictEqual(
              new RepoNotFound({ name: missing })
            );
            expect(yield* Effect.flip(repos.create(taken))).toStrictEqual(
              new RepoExists({ name: taken })
            );
            expect(yield* Effect.flip(repos.fork(taken, taken))).toStrictEqual(
              new RepoExists({ name: taken })
            );
          }),
        { codeless: true }
      )
  );

  // Under load a fork answers 500 after making the repo, and a retry
  // answers 409. The fork's name is the claim's, so the retry converges.
  it.live.each([
    { codeless: false, label: "with codes" },
    { codeless: true, label: "without codes" },
  ])(
    "forks once through a 500 then an already-exists, $label",
    ({ codeless }) =>
      within(
        ({ fake }) =>
          Effect.gen(function* () {
            const repos = yield* RepoHost;
            const base = RepoName.make("demo");
            const name = RepoName.make("demo--fix--alice");
            const { first } = yield* seeded(base);

            const created = yield* repos.fork(base, name).pipe(Effect.orDie);
            const listed = yield* Effect.promise(() => fake.list());

            expect(created).toStrictEqual({
              name,
              remote: `${remoteBase}/${name}.git`,
            });
            expect(
              listed.repos.map((repo) => repo.name).toSorted()
            ).toStrictEqual([base, name]);
            expect(yield* repos.refs(name).pipe(Effect.orDie)).toStrictEqual(
              new Map([[main, first]])
            );
          }),
        { codeless, forkFailures: 1 }
      )
  );

  it.live("reads a fork still in progress as ForkInProgress", () =>
    within(
      () =>
        Effect.gen(function* () {
          const repos = yield* RepoHost;
          const base = RepoName.make("demo");
          const name = RepoName.make("demo--fix--bob");

          yield* seeded(base);

          expect(yield* Effect.flip(repos.fork(base, name))).toStrictEqual(
            new ForkInProgress({ name })
          );
        }),
      {
        wrap: (host) => ({
          ...host,
          fork: (_base, name) => Effect.fail(new ForkInProgress({ name })),
        }),
      }
    )
  );

  // One side-band 3 packet and no report.
  it.live("reads a busy receive-pack as HostBusy, and moves nothing", () =>
    within(({ intercept }) =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const name = RepoName.make("busy");
        const { client, first } = yield* seeded(name);

        const second = yield* client.commit(
          "second",
          [["a.txt", "2"]],
          [first]
        );

        const update = { from: Option.some(first), ref: main, to: second };

        yield* Ref.set(
          intercept,
          Option.some(() => Effect.succeedSome(busyReply()))
        );

        expect(
          yield* Effect.flip(repos.push(name, client.source, [update]))
        ).toStrictEqual(new HostBusy({ name }));
        expect(yield* repos.refs(name).pipe(Effect.orDie)).toStrictEqual(
          new Map([[main, first]])
        );
        expect(
          yield* repos.push(name, client.source, [update]).pipe(Effect.orDie)
        ).toStrictEqual([RefOutcome.Updated({ ref: main })]);
      })
    )
  );

  // git's receive-pack checks the old value the push names.
  it.live(
    "reports a ref that moved during the push as Stale at its new tip",
    () =>
      within(({ intercept, store }) =>
        Effect.gen(function* () {
          const repos = yield* RepoHost;
          const name = RepoName.make("raced");
          const { client, first } = yield* seeded(name);
          const ours = yield* client.commit("ours", [["a.txt", "2"]], [first]);

          const theirs = yield* client.commit(
            "theirs",
            [["a.txt", "3"]],
            [first]
          );

          yield* Ref.set(
            intercept,
            Option.some(() =>
              store
                .push(name, client.source, [
                  { from: Option.some(first), ref: main, to: theirs },
                ])
                .pipe(Effect.orDie, Effect.as(Option.none()))
            )
          );

          expect(
            yield* repos
              .push(name, client.source, [
                { from: Option.some(first), ref: main, to: ours },
              ])
              .pipe(Effect.orDie)
          ).toStrictEqual([
            RefOutcome.Stale({ ref: main, tip: Option.some(theirs) }),
          ]);
        })
      )
  );

  // Artifacts takes any update whose old value matches, and `/memory`
  // and `/local` apply it too: the compare-and-swap is the only check.
  it.live(
    "moves a ref whose tip is `from` to a `to` that is not a fast-forward",
    () =>
      within(() =>
        Effect.gen(function* () {
          const repos = yield* RepoHost;
          const name = RepoName.make("rewound");
          const { client, first } = yield* seeded(name);
          const unrelated = yield* client.commit("unrelated", [["b.txt", "1"]]);

          expect(
            yield* Effect.exit(
              repos.push(name, client.source, [
                { from: Option.some(first), ref: main, to: unrelated },
              ])
            )
          ).toStrictEqual(Exit.succeed([RefOutcome.Updated({ ref: main })]));
          expect(yield* repos.refs(name).pipe(Effect.orDie)).toStrictEqual(
            new Map([[main, unrelated]])
          );
        })
      )
  );

  // The Lander moves its mirror ref to a landing the store already holds,
  // pushing from a scratch repo that holds none of its objects.
  it.live(
    "moves a ref to a commit the store has, from a source that has none of it",
    () =>
      within(() =>
        Effect.gen(function* () {
          const repos = yield* RepoHost;
          const name = RepoName.make("mirrored");
          const { client, first } = yield* seeded(name);
          const empty = yield* gitClient(memoryFs());

          const second = yield* client.commit(
            "second",
            [["a.txt", "2"]],
            [first]
          );

          yield* repos
            .push(name, client.source, [
              { from: Option.none(), ref: landed, to: first },
              { from: Option.some(first), ref: main, to: second },
            ])
            .pipe(Effect.orDie);

          expect(
            yield* Effect.exit(
              repos.push(name, empty.source, [
                { from: Option.some(first), ref: landed, to: second },
              ])
            )
          ).toStrictEqual(Exit.succeed([RefOutcome.Updated({ ref: landed })]));
          expect(yield* repos.refs(name).pipe(Effect.orDie)).toStrictEqual(
            new Map([
              [landed, second],
              [main, second],
            ])
          );
        })
      )
  );

  // Artifacts' `readTree` throws `INTERNAL_ERROR` for an object that is no
  // tree; the other stores read no tree there.
  it.live("reads no tree at a blob's id or a commit's id", () =>
    within(
      () =>
        Effect.gen(function* () {
          const repos = yield* RepoHost;
          const name = RepoName.make("kinds");
          const { first } = yield* seeded(name);

          const commit = yield* repos
            .readCommit(name, first)
            .pipe(Effect.orDie);

          const tree = Option.getOrThrow(
            Option.map(commit, (read) => read.tree)
          );

          const entries = yield* repos.readTree(name, tree).pipe(Effect.orDie);
          const blob = Option.getOrThrow(entries)[0]?.sha ?? tree;

          expect(blob).not.toBe(tree);
          expect(yield* Effect.exit(repos.readTree(name, blob))).toStrictEqual(
            Exit.succeed(Option.none())
          );
          expect(
            yield* Effect.exit(repos.readTree(name, ObjectId.make(first)))
          ).toStrictEqual(Exit.succeed(Option.none()));
        }),
      {
        wrap: (host) => ({
          ...host,
          readTree: (repo, sha) =>
            Effect.gen(function* () {
              const tree = yield* host.readTree(repo, sha);
              const blob = yield* host.readBlob(repo, sha);
              const commit = yield* host.readCommit(repo, CommitSha.make(sha));

              return Option.isNone(tree) &&
                (Option.isSome(blob) || Option.isSome(commit))
                ? yield* Effect.die(
                    Object.assign(new Error("An internal error occurred."), {
                      code: "INTERNAL_ERROR",
                      name: "ArtifactsError",
                      numericCode: 10_400,
                    })
                  )
                : tree;
            }),
        }),
      }
    )
  );
});

describe("tokens and handles the binding takes", () => {
  it.live("leaves no live token on a repo it created, forked or imported", () =>
    within(({ fake }) =>
      Effect.gen(function* () {
        const repos = yield* RepoHost;
        const base = RepoName.make("kept");
        const fork = RepoName.make("kept--fix--bob");
        const imported = RepoName.make("imported");

        yield* seeded(base);
        yield* repos.fork(base, fork).pipe(Effect.orDie);
        yield* repos
          .importFrom(imported, {
            url: yield* repos.remote(base).pipe(Effect.orDie),
          })
          .pipe(Effect.orDie);

        const left = yield* Effect.forEach([base, fork, imported], (name) =>
          Effect.acquireUseRelease(
            Effect.promise(() => fake.get(name)),
            (repo) =>
              Effect.promise(() => repo.listTokens()).pipe(
                Effect.map(
                  ({ tokens: listed }) =>
                    [
                      name,
                      listed.filter(({ state }) => state === "active").length,
                    ] as const
                )
              ),
            (repo) =>
              Effect.sync(() => {
                repo[Symbol.dispose]();
              })
          )
        );

        expect(left).toStrictEqual([
          [base, 0],
          [fork, 0],
          [imported, 0],
        ]);
      })
    )
  );

  it.live.each(["CREATE_IN_PROGRESS", "IMPORT_IN_PROGRESS"] as const)(
    "waits out a repo still being made (%s) before it reads it",
    (code) =>
      within(
        () =>
          Effect.gen(function* () {
            const repos = yield* RepoHost;
            const name = RepoName.make("making");
            const { first } = yield* seeded(name);

            expect(yield* repos.refs(name).pipe(Effect.orDie)).toStrictEqual(
              new Map([[main, first]])
            );
          }),
        { making: { code, gets: 2 } }
      )
  );

  it.live(
    "sends each minted token only to the repo's own remote, then revokes it",
    () =>
      within(({ fake, seen, tokens }) =>
        Effect.gen(function* () {
          const repos = yield* RepoHost;
          const name = RepoName.make("tokens");
          const { client, first } = yield* seeded(name);

          const second = yield* client.commit(
            "second",
            [["a.txt", "2"]],
            [first]
          );

          yield* Ref.set(seen, []);
          tokens.length = 0;

          yield* repos
            .push(name, client.source, [
              { from: Option.some(first), ref: main, to: second },
            ])
            .pipe(Effect.orDie);
          yield* repos.refs(name).pipe(Effect.orDie);

          const requests = yield* Ref.get(seen);

          const repo = yield* Effect.acquireRelease(
            Effect.promise(() => fake.get(name)),
            (handle) =>
              Effect.sync(() => {
                handle[Symbol.dispose]();
              })
          );

          const revoked = yield* Effect.forEach(tokens, ({ id }) =>
            Effect.promise(() => repo.revokeToken(id))
          );

          expect(tokens.length).toBeGreaterThan(0);
          expect(requests.length).toBeGreaterThan(0);
          expect(
            requests.every(
              ({ authorization, url }) =>
                url.startsWith(`${remoteBase}/${name}.git/`) &&
                tokens.some(
                  ({ plaintext }) => authorization === `Bearer ${plaintext}`
                )
            )
          ).toBeTruthy();
          // Revoked already: a second revoke finds nothing.
          expect(revoked.every((again) => !again)).toBeTruthy();
        })
      )
  );

  it.live(
    "disposes every repo handle it opened, after success or failure",
    () =>
      within(({ counts, intercept }) =>
        Effect.gen(function* () {
          const repos = yield* RepoHost;
          const name = RepoName.make("handles");
          const missing = RepoName.make("missing");
          const { client, first } = yield* seeded(name);

          const second = yield* client.commit(
            "second",
            [["a.txt", "2"]],
            [first]
          );

          const at = Revision.Branch({ name: BranchName.make("main") });

          yield* repos
            .push(name, client.source, [
              { from: Option.some(first), ref: main, to: second },
            ])
            .pipe(Effect.orDie);
          yield* repos.refs(name).pipe(Effect.orDie);
          yield* repos.remote(name).pipe(Effect.orDie);
          yield* repos
            .readFile(name, at, RepoPath.make("a.txt"))
            .pipe(Effect.orDie);
          yield* repos.log(name, at, 5).pipe(Effect.orDie);
          yield* repos.readCommit(name, second).pipe(Effect.orDie);

          const token = yield* repos
            .mintToken(name, "read", Duration.minutes(5))
            .pipe(Effect.orDie);

          yield* repos.revokeToken(name, token.id).pipe(Effect.orDie);
          yield* repos
            .fork(name, RepoName.make("handles--fork"))
            .pipe(Effect.orDie);
          yield* Ref.set(
            intercept,
            Option.some(() => Effect.succeedSome(busyReply()))
          );

          const third = yield* client.commit(
            "third",
            [["a.txt", "3"]],
            [second]
          );

          expect(
            yield* Effect.flip(
              repos.push(name, client.source, [
                { from: Option.some(second), ref: main, to: third },
              ])
            )
          ).toStrictEqual(new HostBusy({ name }));
          expect(yield* Effect.flip(repos.refs(missing))).toStrictEqual(
            new RepoNotFound({ name: missing })
          );
          expect(counts.gets).toBeGreaterThan(5);
          expect(counts.disposed).toBe(counts.gets);
        })
      )
  );
});

describe("git smart HTTP over the Fetch port", () => {
  const token = Redacted.make("test-token");

  it.live(
    "lists refs, pushes one compare-and-swap per ref, and fetches a ref",
    () =>
      within(({ fetch, store }) =>
        Effect.gen(function* () {
          const name = RepoName.make("wire");
          const client = yield* gitClient(memoryFs());
          const first = yield* client.commit("first", [["a.txt", "1"]]);

          const second = yield* client.commit(
            "second",
            [["a.txt", "2"]],
            [first]
          );

          const remote = `${remoteBase}/${name}.git`;

          yield* store.create(name).pipe(Effect.orDie);

          const outcomes = yield* pushRefs({
            remote,
            source: client.source,
            token,
            updates: [
              { from: Option.none(), ref: main, to: second },
              { from: Option.some(first), ref: landed, to: second },
            ],
          });

          const fs = memoryFs();

          const fetched = yield* fetchInto({
            depth: 1,
            fs,
            gitdir: "/scratch.git",
            ref: "main",
            remote,
            token,
          });

          const absent = yield* fetchInto({
            fs,
            gitdir: "/scratch.git",
            ref: "absent",
            remote,
            token,
          });

          const read = yield* Effect.promise(() =>
            readCommit({ fs, gitdir: "/scratch.git", oid: second })
          );

          expect(outcomes).toStrictEqual([
            RefOutcome.Updated({ ref: main }),
            RefOutcome.Stale({ ref: landed, tip: Option.none() }),
          ]);
          expect(yield* listRefs(remote, token)).toStrictEqual(
            new Map<RefName, CommitSha>([[main, second]])
          );
          expect(fetched).toStrictEqual(Option.some(second));
          expect(absent).toStrictEqual(Option.none());
          expect(read.commit.message).toBe("second\n");
        }).pipe(Effect.provideService(Fetch, fetch))
      )
  );

  it.live("names the repo a remote does not serve", () =>
    within(({ fetch }) =>
      Effect.gen(function* () {
        const name = RepoName.make("nowhere");
        const remote = `${remoteBase}/${name}.git`;

        expect(yield* Effect.flip(listRefs(remote, token))).toStrictEqual(
          new RepoNotFound({ name })
        );
        expect(
          yield* Effect.flip(
            fetchInto({
              fs: memoryFs(),
              gitdir: "/x.git",
              ref: "main",
              remote,
              token,
            })
          )
        ).toStrictEqual(new RepoNotFound({ name }));
      }).pipe(Effect.provideService(Fetch, fetch))
    )
  );
});
