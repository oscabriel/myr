import { CommitSha } from "@repo/protocol/ids";
import { Array, Data, Effect, Equal, Match, Option, Schema } from "effect";
import type { Semaphore } from "effect";
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
  ObjectId,
  RefName,
  RefOutcome,
  Revision,
  TreeEntry,
} from "../repo-host.ts";
import type {
  Commit,
  PushSource,
  RefUpdate,
  RepoHost,
  RepoName,
  RepoNotFound,
} from "../repo-host.ts";

/**
 * A bare repo's directory on a file system isomorphic-git reads and writes:
 * the shape a push takes its objects from, so every stored repo is a source
 * too.
 */
export type GitDir = PushSource;

/** A repo a store found by name: its directory and the lock its pushes take. */
export interface StoredRepo {
  readonly dir: GitDir;
  readonly lock: Semaphore.Semaphore;
}

/** The ref every repo's HEAD names: Artifacts' default branch. */
export const mainRef = "refs/heads/main";

class GitFailure extends Data.TaggedError("GitFailure")<{
  readonly cause: unknown;
}> {}

const git = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ catch: (cause) => new GitFailure({ cause }), try: run });

/** `None` where isomorphic-git finds no such object, ref or file. */
export const unlessMissing = <A>(
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

/** A new, empty bare repo whose HEAD names `main`. */
export const initBare = (repo: GitDir) =>
  git(() => init({ ...repo, bare: true, defaultBranch: "main" })).pipe(
    Effect.orDie
  );

export const tipOf = (repo: GitDir, ref: string) =>
  unlessMissing(() => resolveRef({ ...repo, ref })).pipe(
    Effect.map(Option.map((sha) => CommitSha.make(sha)))
  );

// The copies write children before parents, so every object in a repo has
// everything it points to.
const copyBlob = (source: PushSource, into: GitDir, oid: string) =>
  Effect.gen(function* () {
    const present = yield* unlessMissing(() => readBlob({ ...into, oid }));

    if (Option.isSome(present)) {
      return;
    }

    const { blob } = yield* git(() => readBlob({ ...source, oid })).pipe(
      Effect.orDie
    );

    yield* keep(oid, () => writeBlob({ ...into, blob }));
  });

const copyTree = (
  source: PushSource,
  into: GitDir,
  oid: string
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const present = yield* unlessMissing(() => readTree({ ...into, oid }));

    if (Option.isSome(present)) {
      return;
    }

    const { tree } = yield* git(() => readTree({ ...source, oid })).pipe(
      Effect.orDie
    );

    // Submodule entries ("commit") point outside the repo; git copies none.
    yield* Effect.forEach(tree, (entry) =>
      Match.value(entry.type).pipe(
        Match.when("blob", () => copyBlob(source, into, entry.oid)),
        Match.when("tree", () => copyTree(source, into, entry.oid)),
        Match.when("commit", () => Effect.void),
        Match.exhaustive
      )
    );
    yield* keep(oid, () => writeTree({ ...into, tree }));
  });

const copyCommit = (
  source: PushSource,
  into: GitDir,
  oid: string
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const present = yield* unlessMissing(() => readCommit({ ...into, oid }));

    if (Option.isSome(present)) {
      return;
    }

    const { commit } = yield* git(() => readCommit({ ...source, oid })).pipe(
      Effect.orDie
    );

    yield* copyTree(source, into, commit.tree);
    yield* Effect.forEach(commit.parent, (parent) =>
      copyCommit(source, into, parent)
    );
    yield* keep(oid, () => writeCommit({ ...into, commit }));
  });

/** Sets the new repo `into`'s `ref` to `source`'s `tip`, objects first. */
export const seedRef = (
  source: PushSource,
  into: GitDir,
  ref: string,
  tip: Option.Option<CommitSha>
) =>
  Effect.gen(function* () {
    if (Option.isNone(tip)) {
      return;
    }

    yield* copyCommit(source, into, tip.value);
    yield* git(() => writeRef({ ...into, ref, value: tip.value })).pipe(
      Effect.orDie
    );
  });

// S1 #3 and #6: each ref is its own compare-and-swap, applied or refused
// whatever the others in the same push come to.
const apply = (into: GitDir, source: PushSource, update: RefUpdate) =>
  Effect.gen(function* () {
    const tip = yield* tipOf(into, update.ref);

    if (!Equal.equals(tip, update.from)) {
      return RefOutcome.Stale({ ref: update.ref, tip });
    }

    yield* copyCommit(source, into, update.to);
    yield* git(() =>
      writeRef({ ...into, force: true, ref: update.ref, value: update.to })
    ).pipe(Effect.orDie);

    return RefOutcome.Updated({ ref: update.ref });
  });

const resolve = (repo: GitDir, at: Revision) =>
  Revision.$match(at, {
    Branch: ({ name }) => tipOf(repo, `refs/heads/${name}`),
    Commit: ({ sha }) => Effect.succeedSome(sha),
  });

// Artifacts drops one trailing newline from a commit message.
const commitAt = (repo: GitDir, sha: CommitSha) =>
  unlessMissing(() => readCommit({ ...repo, oid: sha })).pipe(
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

// isomorphic-git's entries carry `path` and `oid`; the port's, `name` and `sha`.
const decodeEntries = Schema.decodeUnknownEffect(Schema.Array(TreeEntry));

/**
 * The RepoHost methods that read a repo's objects and refs or push to it,
 * the same over every store whose repos are isomorphic-git directories:
 * `known` finds a repo's directory and lock by name. A push is a
 * compare-and-swap per ref under the repo's lock, never atomic across refs
 * (S1 #6); reads resolve short branch names and commit ids only (S1 #20).
 */
export const objectsAndRefs = (
  known: (name: RepoName) => Effect.Effect<StoredRepo, RepoNotFound>
): Pick<
  RepoHost["Service"],
  "log" | "push" | "readBlob" | "readCommit" | "readFile" | "readTree" | "refs"
> => ({
  log: (name, at, limit) =>
    Effect.gen(function* () {
      const { dir } = yield* known(name);
      const commits: Commit[] = [];
      let next = yield* resolve(dir, at);

      while (Option.isSome(next) && commits.length < limit) {
        const commit = yield* commitAt(dir, next.value);

        if (Option.isNone(commit)) {
          break;
        }

        commits.push(commit.value);
        next = Option.fromNullishOr(commit.value.parents[0]);
      }

      return commits;
    }),
  push: (name, source, updates) =>
    Effect.gen(function* () {
      const { dir, lock } = yield* known(name);

      return yield* lock.withPermit(
        Effect.forEach(updates, (update) => apply(dir, source, update))
      );
    }),
  // Only a blob by its own id: no tag or commit is peeled to one.
  readBlob: (name, blob) =>
    Effect.gen(function* () {
      const { dir } = yield* known(name);
      const read = yield* unlessMissing(() => readBlob({ ...dir, oid: blob }));

      return Option.flatMap(read, ({ blob: bytes, oid }) =>
        oid === blob ? Option.some(bytes) : Option.none()
      );
    }),
  readCommit: (name, sha) =>
    known(name).pipe(Effect.flatMap(({ dir }) => commitAt(dir, sha))),
  readFile: (name, at, path) =>
    Effect.gen(function* () {
      const { dir } = yield* known(name);
      const sha = yield* resolve(dir, at);

      if (Option.isNone(sha)) {
        return Option.none();
      }

      const blob = yield* unlessMissing(() =>
        readBlob({ ...dir, filepath: path, oid: sha.value })
      );

      return Option.map(blob, ({ blob: bytes }) => bytes);
    }),
  // Only a tree by its own id: isomorphic-git peels a commit to its tree.
  readTree: (name, tree) =>
    Effect.gen(function* () {
      const { dir } = yield* known(name);
      const read = yield* unlessMissing(() => readTree({ ...dir, oid: tree }));

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
      const { dir } = yield* known(name);

      const names = yield* git(() =>
        listRefs({ ...dir, filepath: "refs" })
      ).pipe(Effect.orDie);

      const listed = yield* Effect.forEach(names, (relative) =>
        Effect.gen(function* () {
          const ref = RefName.make(`refs/${relative}`);
          const tip = yield* tipOf(dir, ref);

          return Option.map(tip, (sha) => [ref, sha] as const);
        })
      );

      return new Map(Array.getSomes(listed));
    }),
});
