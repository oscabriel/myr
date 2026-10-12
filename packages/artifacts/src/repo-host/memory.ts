import type { CommitSha } from "@repo/protocol/ids";
import { DateTime, Effect, Layer, Option, Redacted, Semaphore } from "effect";

import {
  ImportRefused,
  RepoExists,
  RepoHost,
  RepoNotFound,
} from "../repo-host.ts";
import type { RepoCreated, RepoName } from "../repo-host.ts";
import {
  defaultRefOf,
  initBare,
  mainRef,
  objectsAndRefs,
  seedRef,
  tipOf,
} from "./isogit-store.ts";
import type { StoredRepo } from "./isogit-store.ts";
import { memoryFs } from "./memory-fs.ts";

const remoteOf = (name: RepoName) => `memory://${name}.git`;

const branchOf = (ref: string) => ref.replace(/^refs\/heads\//u, "");

const createdOf = (name: RepoName): RepoCreated => ({
  name,
  remote: remoteOf(name),
});

interface Repo extends StoredRepo {
  /** The memory store authenticates nothing. */
  readonly tokens: Set<string>;
}

const make = () => {
  const fs = memoryFs();
  const repos = new Map<RepoName, Repo>();
  let minted = 0;

  const known = (name: RepoName): Effect.Effect<Repo, RepoNotFound> => {
    const repo = repos.get(name);

    return repo === undefined
      ? Effect.fail(new RepoNotFound({ name }))
      : Effect.succeed(repo);
  };

  const open = (name: RepoName) =>
    Effect.gen(function* () {
      if (repos.has(name)) {
        return yield* new RepoExists({ name });
      }

      const repo: Repo = {
        dir: { fs, gitdir: `/${name}.git` },
        lock: Semaphore.makeUnsafe(1),
        tokens: new Set(),
      };

      repos.set(name, repo);
      yield* initBare(repo.dir);

      return repo;
    });

  const seed = (
    from: Repo,
    name: RepoName,
    ref: string,
    tip: Option.Option<CommitSha>
  ) =>
    Effect.gen(function* () {
      const repo = yield* open(name);

      yield* seedRef(from.dir, repo.dir, ref, tip);

      return createdOf(name);
    });

  return RepoHost.of({
    ...objectsAndRefs(known),
    create: (name) => open(name).pipe(Effect.as(createdOf(name))),
    // The default branch only, copied as it stands: later pushes to the base
    // or to a sibling never reach this fork.
    fork: (base, name) =>
      Effect.gen(function* () {
        const from = yield* known(base);
        const tip = yield* tipOf(from.dir, mainRef);

        return yield* seed(from, name, mainRef, tip);
      }),
    // Its test-only meaning of a public remote: another repo in this store,
    // named by its `remote()` URL.
    importFrom: (name, source) =>
      Effect.gen(function* () {
        if (repos.has(name)) {
          return yield* new RepoExists({ name });
        }

        const from = [...repos].find(
          ([other]) => remoteOf(other) === source.url
        )?.[1];

        if (from === undefined) {
          return yield* new ImportRefused({
            name,
            reason: `no repo at ${source.url}`,
          });
        }

        const named =
          source.branch === undefined
            ? yield* defaultRefOf(from.dir)
            : Option.some(`refs/heads/${source.branch}`);

        if (Option.isNone(named)) {
          return yield* new ImportRefused({
            name,
            reason: `${source.url} has no default branch`,
          });
        }

        const ref = named.value;
        const tip = yield* tipOf(from.dir, ref);

        if (Option.isNone(tip)) {
          return yield* new ImportRefused({
            name,
            reason: `${source.url} has no branch ${branchOf(ref)}`,
          });
        }

        return yield* seed(from, name, ref, tip);
      }),
    mintToken: (name, scope, ttl) =>
      Effect.gen(function* () {
        const repo = yield* known(name);
        const now = yield* DateTime.now;

        minted += 1;

        const id = `token-${minted}`;

        repo.tokens.add(id);

        return {
          expiresAt: DateTime.addDuration(now, ttl),
          id,
          scope,
          secret: Redacted.make(`memory-${id}`),
        };
      }),
    remote: (name) => known(name).pipe(Effect.as(remoteOf(name))),
    remove: (name) =>
      Effect.sync(() => {
        const repo = repos.get(name);

        if (repo === undefined) {
          return false;
        }

        fs.removeTree(repo.dir.gitdir);

        return repos.delete(name);
      }),
    revokeToken: (name, id) =>
      known(name).pipe(Effect.map((repo) => repo.tokens.delete(id))),
  });
};

export const RepoHostMemory = Layer.sync(RepoHost, make);
