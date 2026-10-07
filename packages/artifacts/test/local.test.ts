import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { gitOk } from "@repo/testkit/git";
import { gitClient } from "@repo/testkit/git-client";
import { httpBackend } from "@repo/testkit/http-backend";
import { Context, Duration, Effect, FileSystem, Layer, Option } from "effect";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { ChildProcessSpawner } from "effect/process";

import { Fetch, FetchFailed } from "../src/fetch.ts";
import {
  BranchName,
  ImportRefused,
  RefName,
  RepoHost,
  RepoName,
} from "../src/repo-host.ts";
import { RepoHostLocal } from "../src/repo-host/local.ts";
import { memoryFs } from "../src/repo-host/memory-fs.ts";
import { describeRepoHost } from "./repo-host-contract.ts";
import { temporaryRoot } from "./temporary-root.ts";

const main = RefName.make("refs/heads/main");

/** No network: every request fails as an unreachable host's would. */
const offline = Layer.succeed(
  Fetch,
  Fetch.of({
    fetch: (request) =>
      Effect.fail(new FetchFailed({ reason: "offline", url: request.url })),
  })
);

/** The store in `root`, whose remotes are its repos' own `file://` URLs. */
const storeAt = (root: string) =>
  RepoHostLocal.layer({ remoteBase: `file://${root}`, root }).pipe(
    Layer.provide(offline)
  );

/** A store in a new temporary directory, removed when the test ends. */
const freshStore = Layer.unwrap(Effect.map(temporaryRoot, storeAt));

/** Real `git http-backend` over `root` on a local port: its base URL. */
const served = (root: string) =>
  Effect.gen(function* () {
    const spawner =
      yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();

    const backend = httpBackend(root);

    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.toWeb(
        yield* HttpServerRequest.HttpServerRequest
      );

      return HttpServerResponse.fromWeb(
        yield* Effect.scoped(backend(request)).pipe(Effect.provide(spawner))
      );
    }).pipe(Effect.orDie);

    const server = yield* Layer.build(
      HttpServer.serve(app).pipe(Layer.provideMerge(NodeHttpServer.layerTest))
    ).pipe(Effect.orDie);

    const { address } = Context.get(server, HttpServer.HttpServer);

    return "port" in address
      ? `http://127.0.0.1:${address.port}`
      : yield* Effect.die("the test server listens on a socket, not a port");
  });

// Its test-only meaning of a public remote: another bare repo on disk, named
// by its `file://` URL.
describeRepoHost("local", freshStore, {
  importUrl: (name) =>
    RepoHost.use((repos) => repos.remote(name)).pipe(Effect.orDie),
});

describe("bare repos on local disk", () => {
  // The issue's Check: what the adapter stores is a repo real git can clone
  // over smart HTTP, served by `git http-backend` from the same root.
  it.live(
    "serves a pushed file to a real git clone of its remote",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);
        const work = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);
        const client = yield* gitClient(memoryFs());
        const first = yield* client.commit("first", [["src/a.ts", "v1\n"]]);
        const name = RepoName.make("demo");

        const remote = yield* RepoHost.use((repos) =>
          Effect.gen(function* () {
            yield* repos.create(name);
            yield* repos.push(name, client.source, [
              { from: Option.none(), ref: main, to: first },
            ]);

            return yield* repos.remote(name);
          })
        ).pipe(
          Effect.provide(
            RepoHostLocal.layer({
              remoteBase: yield* served(root),
              root,
            }).pipe(Layer.provide(offline))
          )
        );

        yield* gitOk(work, "clone", "--quiet", remote, "clone");

        expect(
          yield* fs.readFileString(`${work}/clone/src/a.ts`).pipe(Effect.orDie)
        ).toBe("v1\n");
      }).pipe(Effect.provide(NodeServices.layer)),
    30_000
  );

  it.effect("names each repo's remote under the base it was given", () =>
    Effect.gen(function* () {
      const root = yield* temporaryRoot;
      const name = RepoName.make("demo");

      const remote = yield* RepoHost.use((repos) =>
        Effect.andThen(repos.create(name), repos.remote(name))
      ).pipe(
        Effect.provide(
          RepoHostLocal.layer({
            remoteBase: "http://127.0.0.1:8080/git",
            root,
          }).pipe(Layer.provide(offline))
        )
      );

      expect(remote).toBe("http://127.0.0.1:8080/git/demo.git");
    })
  );

  it.effect(
    "keeps repos, refs and tokens for the next layer over the same root",
    () =>
      Effect.gen(function* () {
        const root = yield* temporaryRoot;
        const client = yield* gitClient(memoryFs());
        const first = yield* client.commit("first", [["a", "1"]]);
        const name = RepoName.make("kept");

        const minted = yield* RepoHost.use((repos) =>
          Effect.gen(function* () {
            yield* repos.create(name);
            yield* repos.push(name, client.source, [
              { from: Option.none(), ref: main, to: first },
            ]);

            return yield* repos.mintToken(name, "write", Duration.hours(1));
          })
        ).pipe(Effect.provide(storeAt(root)));

        const later = yield* RepoHost.use((repos) =>
          Effect.gen(function* () {
            const refs = yield* repos.refs(name);
            const revoked = yield* repos.revokeToken(name, minted.id);

            const next = yield* repos.mintToken(
              name,
              "read",
              Duration.hours(1)
            );

            return { next, refs, revoked };
          })
        ).pipe(Effect.provide(storeAt(root)));

        expect(later.refs).toStrictEqual(new Map([[main, first]]));
        expect(later.revoked).toBeTruthy();
        expect(later.next.id).not.toBe(minted.id);
        expect(
          yield* RepoHost.use((repos) =>
            Effect.all([
              repos.revokeToken(name, minted.id),
              repos.revokeToken(name, later.next.id),
            ])
          ).pipe(Effect.provide(storeAt(root)))
        ).toStrictEqual([false, true]);
      })
  );
});

describe("importing onto local disk", () => {
  it.effect("imports the branch it names, under that name", () =>
    Effect.gen(function* () {
      const repos = yield* RepoHost;
      const client = yield* gitClient(memoryFs());
      const first = yield* client.commit("first", [["a", "1"]]);
      const release = RefName.make("refs/heads/release");
      const remote = RepoName.make("branches");
      const name = RepoName.make("from-a-branch");

      yield* repos.create(remote);
      yield* repos.push(remote, client.source, [
        { from: Option.none(), ref: release, to: first },
      ]);

      yield* repos.importFrom(name, {
        branch: BranchName.make("release"),
        url: yield* repos.remote(remote),
      });

      expect(yield* repos.refs(name)).toStrictEqual(
        new Map([[release, first]])
      );
    }).pipe(Effect.provide(freshStore))
  );

  it.effect("refuses a path that holds no repo, and makes no repo", () =>
    Effect.gen(function* () {
      const repos = yield* RepoHost;
      const name = RepoName.make("nowhere");
      const url = "file:///nonexistent/demo.git";

      expect(yield* Effect.flip(repos.importFrom(name, { url }))).toStrictEqual(
        new ImportRefused({ name, reason: `no repo at ${url}` })
      );
      expect(yield* repos.remove(name)).toBeFalsy();
    }).pipe(Effect.provide(freshStore))
  );

  // A file URL that names another machine is no path on this one.
  it.effect("refuses a file URL on another host, and makes no repo", () =>
    Effect.gen(function* () {
      const repos = yield* RepoHost;
      const name = RepoName.make("elsewhere");
      const url = "file://example.com/demo.git";

      expect(yield* Effect.flip(repos.importFrom(name, { url }))).toStrictEqual(
        new ImportRefused({ name, reason: `no repo at ${url}` })
      );
      expect(yield* repos.remove(name)).toBeFalsy();
    }).pipe(Effect.provide(freshStore))
  );

  it.effect("refuses a branch the remote lacks, and makes no repo", () =>
    Effect.gen(function* () {
      const repos = yield* RepoHost;
      const remote = RepoName.make("empty-remote");
      const name = RepoName.make("from-nothing");

      yield* repos.create(remote);

      const url = yield* repos.remote(remote);

      expect(
        yield* Effect.flip(
          repos.importFrom(name, { branch: BranchName.make("absent"), url })
        )
      ).toStrictEqual(
        new ImportRefused({ name, reason: `${url} has no branch absent` })
      );
      expect(yield* repos.remove(name)).toBeFalsy();
    }).pipe(Effect.provide(freshStore))
  );

  it.effect("refuses an HTTPS remote it cannot reach, and makes no repo", () =>
    Effect.gen(function* () {
      const repos = yield* RepoHost;
      const name = RepoName.make("unreachable");
      const url = "https://example.com/demo.git";

      expect(yield* Effect.flip(repos.importFrom(name, { url }))).toStrictEqual(
        new ImportRefused({
          name,
          reason: `${url} could not be fetched: offline`,
        })
      );
      expect(yield* repos.remove(name)).toBeFalsy();
    }).pipe(Effect.provide(freshStore))
  );

  it.effect("refuses a remote that is neither a file nor HTTP", () =>
    Effect.gen(function* () {
      const repos = yield* RepoHost;
      const name = RepoName.make("over-ssh");
      const url = "ssh://example.com/demo.git";

      expect(yield* Effect.flip(repos.importFrom(name, { url }))).toStrictEqual(
        new ImportRefused({ name, reason: `${url} is not a file or HTTP URL` })
      );
    }).pipe(Effect.provide(freshStore))
  );
});
