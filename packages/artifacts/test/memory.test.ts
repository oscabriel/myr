import { describe, expect, it } from "@effect/vitest";
import { gitClient } from "@repo/testkit/git-client";
import { Effect, Option } from "effect";

import {
  BranchName,
  ImportRefused,
  RefName,
  RepoHost,
  RepoName,
  RepoNotFound,
} from "../src/repo-host.ts";
import { memoryFs } from "../src/repo-host/memory-fs.ts";
import { RepoHostMemory } from "../src/repo-host/memory.ts";
import { describeRepoHost } from "./repo-host-contract.ts";

// Its test-only meaning of a public remote: another repo in the same store.
describeRepoHost("memory", RepoHostMemory, {
  importUrl: (name) =>
    RepoHost.use((repos) => repos.remote(name)).pipe(Effect.orDie),
});

describe("importing into the memory store", () => {
  it.effect("imports the branch it names, under that name", () =>
    Effect.gen(function* () {
      const repos = yield* RepoHost;
      const client = yield* gitClient(memoryFs());
      const first = yield* client.commit("first", [["a", "1"]]);
      const remote = RepoName.make("branches");
      const name = RepoName.make("from-a-branch");

      yield* repos.create(remote);
      yield* repos.push(remote, client.source, [
        {
          from: Option.none(),
          ref: RefName.make("refs/heads/release"),
          to: first,
        },
      ]);

      yield* repos.importFrom(name, {
        branch: BranchName.make("release"),
        url: yield* repos.remote(remote),
      });

      expect(yield* repos.refs(name)).toStrictEqual(
        new Map([[RefName.make("refs/heads/release"), first]])
      );
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("refuses a remote that is no repo in the store", () =>
    Effect.gen(function* () {
      const repos = yield* RepoHost;
      const name = RepoName.make("nowhere");

      expect(
        yield* Effect.flip(
          repos.importFrom(name, { url: "https://example.com/demo.git" })
        )
      ).toStrictEqual(
        new ImportRefused({
          name,
          reason: "no repo at https://example.com/demo.git",
        })
      );
      expect(yield* Effect.flip(repos.refs(name))).toStrictEqual(
        new RepoNotFound({ name })
      );
    }).pipe(Effect.provide(RepoHostMemory))
  );

  it.effect("refuses a branch the remote lacks, and makes no repo", () =>
    Effect.gen(function* () {
      const repos = yield* RepoHost;
      const remote = RepoName.make("empty-remote");
      const name = RepoName.make("from-nothing");

      yield* repos.create(remote);

      const url = yield* repos.remote(remote);

      expect(yield* Effect.flip(repos.importFrom(name, { url }))).toStrictEqual(
        new ImportRefused({ name, reason: `${url} has no branch main` })
      );
      expect(yield* repos.remove(name)).toBeFalsy();
    }).pipe(Effect.provide(RepoHostMemory))
  );
});
