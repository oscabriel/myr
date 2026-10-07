import { describe, expect, it } from "@effect/vitest";
import { gitClient } from "@repo/testkit/git-client";
import { Duration, Effect, Layer, Option } from "effect";

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
const freshStore = Layer.unwrap(
  Effect.map(RepoHostLocal.temporaryRoot, storeAt)
);

// Its test-only meaning of a public remote: another bare repo on disk, named
// by its `file://` URL.
describeRepoHost("local", freshStore, {
  importUrl: (name) =>
    RepoHost.use((repos) => repos.remote(name)).pipe(Effect.orDie),
});

describe("bare repos on local disk", () => {
  it.effect("names each repo's remote under the base it was given", () =>
    Effect.gen(function* () {
      const root = yield* RepoHostLocal.temporaryRoot;
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
        const root = yield* RepoHostLocal.temporaryRoot;
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
