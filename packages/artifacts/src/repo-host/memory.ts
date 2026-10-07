import { CommitSha } from "@repo/protocol/ids";
import {
  Array,
  Data,
  DateTime,
  Effect,
  Equal,
  Layer,
  Match,
  Option,
  Redacted,
  Schema,
  Semaphore,
} from "effect";
import {
  Errors,
  init,
  listRefs,
  readBlob,
  readCommit,
  readTree,
  resolveRef,
  writeBlob,
  writeCommit,
  writeRef,
  writeTree,
} from "isomorphic-git";

import {
  ImportRefused,
  ObjectId,
  RefName,
  RefOutcome,
  RepoExists,
  RepoHost,
  RepoNotFound,
  Revision,
  TreeEntry,
} from "../repo-host.ts";
import type {
  Commit,
  PushSource,
  RefUpdate,
  RepoCreated,
  RepoName,
} from "../repo-host.ts";
import { memoryFs } from "./memory-fs.ts";

class GitFailure extends Data.TaggedError("GitFailure")<{
  readonly cause: unknown;
}> {}

const git = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ catch: (cause) => new GitFailure({ cause }), try: run });

/** `None` where isomorphic-git finds no such object, ref or file. */
const unlessMissing = <A>(
  run: () => Promise<A>
): Effect.Effect<Option.Option<A>> =>
  git(run).pipe(
    Effect.asSome,
    Effect.catchIf(
      (failure) =>
        failure.cause instanceof Errors.NotFoundError ||
        failure.cause instanceof Errors.ObjectTypeError,
      () => Effect.succeedNone
    ),
    Effect.orDie
  );

// Each object is rewritten from its parsed form; a changed id would mean the
// copy is not the object the pusher sent.
const keep = (oid: string, write: () => Promise<string>) =>
  git(write).pipe(
    Effect.orDie,
    Effect.flatMap((written) =>
      written === oid
        ? Effect.void
        : Effect.die(`copying ${oid} produced ${written}`)
    )
  );

const mainRef = "refs/heads/main";

// isomorphic-git's entries carry `path` and `oid`; the port's, `name` and `sha`.
const decodeEntries = Schema.decodeUnknownEffect(Schema.Array(TreeEntry));

const remoteOf = (name: RepoName) => `memory://${name}.git`;

const createdOf = (name: RepoName): RepoCreated => ({
  name,
  remote: remoteOf(name),
});

interface Repo {
  readonly gitdir: string;
  readonly lock: Semaphore.Semaphore;
  /** Token ids still live; the memory store authenticates nothing. */
  readonly tokens: Set<string>;
}

/**
 * Artifacts in memory, as S1 found it: each repo a bare git directory, a push
 * a compare-and-swap per ref with no atomicity across refs, and reads that
 * resolve short branch names and commit ids only.
 */
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

  const tipOf = (repo: Repo, ref: string) =>
    unlessMissing(() => resolveRef({ fs, gitdir: repo.gitdir, ref })).pipe(
      Effect.map(Option.map((sha) => CommitSha.make(sha)))
    );

  // The copies write children before parents, so every object in a repo has
  // everything it points to.
  const copyBlob = (source: PushSource, repo: Repo, oid: string) =>
    Effect.gen(function* () {
      const present = yield* unlessMissing(() =>
        readBlob({ fs, gitdir: repo.gitdir, oid })
      );

      if (Option.isSome(present)) {
        return;
      }

      const { blob } = yield* git(() => readBlob({ ...source, oid })).pipe(
        Effect.orDie
      );

      yield* keep(oid, () => writeBlob({ blob, fs, gitdir: repo.gitdir }));
    });

  const copyTree = (
    source: PushSource,
    repo: Repo,
    oid: string
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const present = yield* unlessMissing(() =>
        readTree({ fs, gitdir: repo.gitdir, oid })
      );

      if (Option.isSome(present)) {
        return;
      }

      const { tree } = yield* git(() => readTree({ ...source, oid })).pipe(
        Effect.orDie
      );

      // Submodule entries ("commit") point outside the repo; git copies none.
      yield* Effect.forEach(tree, (entry) =>
        Match.value(entry.type).pipe(
          Match.when("blob", () => copyBlob(source, repo, entry.oid)),
          Match.when("tree", () => copyTree(source, repo, entry.oid)),
          Match.when("commit", () => Effect.void),
          Match.exhaustive
        )
      );
      yield* keep(oid, () => writeTree({ fs, gitdir: repo.gitdir, tree }));
    });

  const copyCommit = (
    source: PushSource,
    repo: Repo,
    oid: string
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const present = yield* unlessMissing(() =>
        readCommit({ fs, gitdir: repo.gitdir, oid })
      );

      if (Option.isSome(present)) {
        return;
      }

      const { commit } = yield* git(() => readCommit({ ...source, oid })).pipe(
        Effect.orDie
      );

      yield* copyTree(source, repo, commit.tree);
      yield* Effect.forEach(commit.parent, (parent) =>
        copyCommit(source, repo, parent)
      );
      yield* keep(oid, () => writeCommit({ commit, fs, gitdir: repo.gitdir }));
    });

  const apply = (repo: Repo, source: PushSource, update: RefUpdate) =>
    Effect.gen(function* () {
      const tip = yield* tipOf(repo, update.ref);

      if (!Equal.equals(tip, update.from)) {
        return RefOutcome.Stale({ ref: update.ref, tip });
      }

      yield* copyCommit(source, repo, update.to);
      yield* git(() =>
        writeRef({
          force: true,
          fs,
          gitdir: repo.gitdir,
          ref: update.ref,
          value: update.to,
        })
      ).pipe(Effect.orDie);

      return RefOutcome.Updated({ ref: update.ref });
    });

  const resolve = (repo: Repo, at: Revision) =>
    Revision.$match(at, {
      Branch: ({ name }) => tipOf(repo, `refs/heads/${name}`),
      Commit: ({ sha }) => Effect.succeedSome(sha),
    });

  // Artifacts drops one trailing newline from a commit message.
  const commitAt = (repo: Repo, sha: CommitSha) =>
    unlessMissing(() => readCommit({ fs, gitdir: repo.gitdir, oid: sha })).pipe(
      Effect.map(
        Option.map(({ commit, oid }): Commit => ({
          author: { email: commit.author.email, name: commit.author.name },
          committer: {
            email: commit.committer.email,
            name: commit.committer.name,
          },
          message: commit.message.replace(/\n$/u, ""),
          parents: commit.parent.map((parent) => CommitSha.make(parent)),
          sha: CommitSha.make(oid),
          tree: ObjectId.make(commit.tree),
        }))
      )
    );

  const open = (name: RepoName) =>
    Effect.gen(function* () {
      if (repos.has(name)) {
        return yield* new RepoExists({ name });
      }

      const repo: Repo = {
        gitdir: `/${name}.git`,
        lock: Semaphore.makeUnsafe(1),
        tokens: new Set(),
      };

      repos.set(name, repo);
      yield* git(() =>
        init({ bare: true, defaultBranch: "main", fs, gitdir: repo.gitdir })
      ).pipe(Effect.orDie);

      return repo;
    });

  /** A new repo `name` holding `from`'s `ref` at `tip`, copied as it stands. */
  const seed = (
    from: Repo,
    name: RepoName,
    ref: string,
    tip: Option.Option<CommitSha>
  ) =>
    Effect.gen(function* () {
      const repo = yield* open(name);

      if (Option.isSome(tip)) {
        yield* copyCommit({ fs, gitdir: from.gitdir }, repo, tip.value);
        yield* git(() =>
          writeRef({ fs, gitdir: repo.gitdir, ref, value: tip.value })
        ).pipe(Effect.orDie);
      }

      return createdOf(name);
    });

  return RepoHost.of({
    create: (name) => open(name).pipe(Effect.as(createdOf(name))),
    // The default branch only, copied as it stands: later pushes to the base
    // or to a sibling never reach this fork.
    fork: (base, name) =>
      Effect.gen(function* () {
        const from = yield* known(base);
        const tip = yield* tipOf(from, mainRef);

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

        const ref = `refs/heads/${source.branch ?? "main"}`;
        const tip = yield* tipOf(from, ref);

        if (Option.isNone(tip)) {
          return yield* new ImportRefused({
            name,
            reason: `${source.url} has no branch ${source.branch ?? "main"}`,
          });
        }

        return yield* seed(from, name, ref, tip);
      }),
    log: (name, at, limit) =>
      Effect.gen(function* () {
        const repo = yield* known(name);
        const commits: Commit[] = [];
        let next = yield* resolve(repo, at);

        while (Option.isSome(next) && commits.length < limit) {
          const commit = yield* commitAt(repo, next.value);

          if (Option.isNone(commit)) {
            break;
          }

          commits.push(commit.value);
          next = Option.fromNullishOr(commit.value.parents[0]);
        }

        return commits;
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
    push: (name, source, updates) =>
      Effect.gen(function* () {
        const repo = yield* known(name);

        return yield* repo.lock.withPermit(
          Effect.forEach(updates, (update) => apply(repo, source, update))
        );
      }),
    // Only a blob by its own id: no tag or commit is peeled to one.
    readBlob: (name, blob) =>
      Effect.gen(function* () {
        const repo = yield* known(name);

        const read = yield* unlessMissing(() =>
          readBlob({ fs, gitdir: repo.gitdir, oid: blob })
        );

        return Option.flatMap(read, ({ blob: bytes, oid }) =>
          oid === blob ? Option.some(bytes) : Option.none()
        );
      }),
    readCommit: (name, sha) =>
      known(name).pipe(Effect.flatMap((repo) => commitAt(repo, sha))),
    readFile: (name, at, path) =>
      Effect.gen(function* () {
        const repo = yield* known(name);
        const sha = yield* resolve(repo, at);

        if (Option.isNone(sha)) {
          return Option.none();
        }

        const blob = yield* unlessMissing(() =>
          readBlob({
            filepath: path,
            fs,
            gitdir: repo.gitdir,
            oid: sha.value,
          })
        );

        return Option.map(blob, ({ blob: bytes }) => bytes);
      }),
    // Only a tree by its own id: isomorphic-git peels a commit to its tree.
    readTree: (name, tree) =>
      Effect.gen(function* () {
        const repo = yield* known(name);

        const read = yield* unlessMissing(() =>
          readTree({ fs, gitdir: repo.gitdir, oid: tree })
        );

        if (Option.isNone(read) || read.value.oid !== tree) {
          return Option.none();
        }

        const entries = yield* decodeEntries(
          read.value.tree.map((entry) => ({
            mode: entry.mode,
            name: entry.path,
            sha: entry.oid,
            type: entry.type,
          }))
        ).pipe(Effect.orDie);

        return Option.some(entries);
      }),
    refs: (name) =>
      Effect.gen(function* () {
        const repo = yield* known(name);

        const names = yield* git(() =>
          listRefs({ filepath: "refs", fs, gitdir: repo.gitdir })
        ).pipe(Effect.orDie);

        const listed = yield* Effect.forEach(names, (relative) =>
          Effect.gen(function* () {
            const ref = RefName.make(`refs/${relative}`);
            const tip = yield* tipOf(repo, ref);

            return Option.map(tip, (sha) => [ref, sha] as const);
          })
        );

        return new Map(Array.getSomes(listed));
      }),
    remote: (name) => known(name).pipe(Effect.as(remoteOf(name))),
    remove: (name) =>
      Effect.sync(() => {
        const repo = repos.get(name);

        if (repo === undefined) {
          return false;
        }

        fs.removeTree(repo.gitdir);

        return repos.delete(name);
      }),
    revokeToken: (name, id) =>
      known(name).pipe(Effect.map((repo) => repo.tokens.delete(id))),
  });
};

/** A fresh, empty store each time the layer is built. */
export const RepoHostMemory = Layer.sync(RepoHost, make);
