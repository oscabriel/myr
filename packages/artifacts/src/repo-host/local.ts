import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

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
  Stream,
} from "effect";
import type { Context, Scope } from "effect";
import {
  Errors,
  addRemote,
  currentBranch,
  deleteRemote,
  fetch as fetchPack,
  hashBlob,
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
import type {
  GitHttpRequest,
  GitHttpResponse,
  HttpClient,
} from "isomorphic-git";

import { Fetch, FetchFailed } from "../fetch.ts";
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
  BranchName,
  Commit,
  PushSource,
  RefUpdate,
  RepoCreated,
  RepoName,
} from "../repo-host.ts";

/** A promise from isomorphic-git or the file system that rejected. */
class IoFailure extends Data.TaggedError("IoFailure")<{
  readonly cause: unknown;
}> {}

const io = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ catch: (cause) => new IoFailure({ cause }), try: run });

/** Whether a file-system call failed with node's error `code`. */
const failedWith = (code: "EEXIST" | "ENOENT") => (failure: IoFailure) =>
  failure.cause instanceof Error &&
  "code" in failure.cause &&
  failure.cause.code === code;

/** `None` where isomorphic-git finds no such object, ref or file. */
const unlessMissing = <A>(
  run: () => Promise<A>
): Effect.Effect<Option.Option<A>> =>
  io(run).pipe(
    Effect.asSome,
    Effect.catchIf(
      (failure) =>
        failure.cause instanceof Errors.NotFoundError ||
        failure.cause instanceof Errors.ObjectTypeError,
      () => Effect.succeedNone
    ),
    Effect.orDie
  );

/** Whether anything is at `path`. */
const exists = (path: string) =>
  io(() => fs.promises.stat(path)).pipe(
    Effect.as(true),
    Effect.catchIf(failedWith("ENOENT"), () => Effect.succeed(false)),
    Effect.orDie
  );

/** Deletes `path` and everything under it; whether there was anything. */
const removeAll = (path: string) =>
  Effect.gen(function* () {
    const found = yield* exists(path);

    yield* io(() =>
      fs.promises.rm(path, { force: true, recursive: true })
    ).pipe(Effect.orDie);

    return found;
  });

// Each object is rewritten from its parsed form; a changed id would mean the
// copy is not the object the pusher sent.
const keep = (oid: string, write: () => Promise<string>) =>
  io(write).pipe(
    Effect.orDie,
    Effect.flatMap((written) =>
      written === oid
        ? Effect.void
        : Effect.die(`copying ${oid} produced ${written}`)
    )
  );

const mainRef = "refs/heads/main";

/** The remote an HTTP import fetches through, removed once it has. */
const importRemote = "import";

const branchOf = (ref: string) => ref.replace(/^refs\/heads\//u, "");

const tipOf = (gitdir: string, ref: string) =>
  unlessMissing(() => resolveRef({ fs, gitdir, ref })).pipe(
    Effect.map(Option.map((sha) => CommitSha.make(sha)))
  );

// The copies write children before parents, so every object in a repo has
// everything it points to.
const copyBlob = (source: PushSource, gitdir: string, oid: string) =>
  Effect.gen(function* () {
    const present = yield* unlessMissing(() => readBlob({ fs, gitdir, oid }));

    if (Option.isSome(present)) {
      return;
    }

    const { blob } = yield* io(() => readBlob({ ...source, oid })).pipe(
      Effect.orDie
    );

    yield* keep(oid, () => writeBlob({ blob, fs, gitdir }));
  });

const copyTree = (
  source: PushSource,
  gitdir: string,
  oid: string
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const present = yield* unlessMissing(() => readTree({ fs, gitdir, oid }));

    if (Option.isSome(present)) {
      return;
    }

    const { tree } = yield* io(() => readTree({ ...source, oid })).pipe(
      Effect.orDie
    );

    // Submodule entries ("commit") point outside the repo; git copies none.
    yield* Effect.forEach(tree, (entry) =>
      Match.value(entry.type).pipe(
        Match.when("blob", () => copyBlob(source, gitdir, entry.oid)),
        Match.when("tree", () => copyTree(source, gitdir, entry.oid)),
        Match.when("commit", () => Effect.void),
        Match.exhaustive
      )
    );
    yield* keep(oid, () => writeTree({ fs, gitdir, tree }));
  });

const copyCommit = (
  source: PushSource,
  gitdir: string,
  oid: string
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const present = yield* unlessMissing(() => readCommit({ fs, gitdir, oid }));

    if (Option.isSome(present)) {
      return;
    }

    const { commit } = yield* io(() => readCommit({ ...source, oid })).pipe(
      Effect.orDie
    );

    yield* copyTree(source, gitdir, commit.tree);
    yield* Effect.forEach(commit.parent, (parent) =>
      copyCommit(source, gitdir, parent)
    );
    yield* keep(oid, () => writeCommit({ commit, fs, gitdir }));
  });

// S1 #3 and #6: each ref is its own compare-and-swap, applied or refused
// whatever the others in the same push come to.
const apply = (gitdir: string, source: PushSource, update: RefUpdate) =>
  Effect.gen(function* () {
    const tip = yield* tipOf(gitdir, update.ref);

    if (!Equal.equals(tip, update.from)) {
      return RefOutcome.Stale({ ref: update.ref, tip });
    }

    yield* copyCommit(source, gitdir, update.to);
    yield* io(() =>
      writeRef({ force: true, fs, gitdir, ref: update.ref, value: update.to })
    ).pipe(Effect.orDie);

    return RefOutcome.Updated({ ref: update.ref });
  });

const resolve = (gitdir: string, at: Revision) =>
  Revision.$match(at, {
    Branch: ({ name }) => tipOf(gitdir, `refs/heads/${name}`),
    Commit: ({ sha }) => Effect.succeedSome(sha),
  });

// Artifacts drops one trailing newline from a commit message.
const commitAt = (gitdir: string, sha: CommitSha) =>
  unlessMissing(() => readCommit({ fs, gitdir, oid: sha })).pipe(
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
 * The tokens a repo has minted, kept beside its objects so that every layer
 * over the same root sees them. `minted` counts every token ever minted, so
 * no two get the same id.
 */
const Tokens = Schema.fromJsonString(
  Schema.Struct({ live: Schema.Array(Schema.String), minted: Schema.Int })
);

type Tokens = typeof Tokens.Type;

const noTokens: Tokens = { live: [], minted: 0 };

const concat = (chunks: readonly Uint8Array[]) => {
  const all = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let at = 0;

  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }

  return all;
};

/**
 * A request body as one array. isomorphic-git types it as an async iterator
 * but sends an array of chunks, so this takes either.
 */
const bytesOf = (body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>) =>
  (Symbol.asyncIterator in body
    ? Stream.fromAsyncIterable(body, (cause) => new IoFailure({ cause }))
    : Stream.fromIterable(body)
  ).pipe(Stream.runCollect, Effect.map(concat));

/** One chunk as the async iterator isomorphic-git reads a response body from. */
const once = (bytes: Uint8Array): AsyncIterableIterator<Uint8Array> => {
  const chunks = [bytes];

  const iterator: AsyncIterableIterator<Uint8Array> = {
    [Symbol.asyncIterator]: () => iterator,
    next: () => {
      const chunk = chunks.shift();

      return Promise.resolve(
        chunk === undefined
          ? { done: true, value: undefined }
          : { done: false, value: chunk }
      );
    },
  };

  return iterator;
};

/**
 * isomorphic-git's HTTP client over a `Fetch`. isomorphic-git awaits a
 * promise, so each exchange runs as one; a `Fetch` failure rejects it as is.
 */
const httpOver = (
  fetch: Fetch["Service"]["fetch"],
  context: Context.Context<never>
): HttpClient => ({
  request: (request: GitHttpRequest) =>
    Effect.runPromiseWith(context)(
      Effect.gen(function* () {
        const body =
          request.body === undefined
            ? {}
            : { body: yield* bytesOf(request.body) };

        const response = yield* fetch(
          new Request(request.url, {
            ...body,
            headers: request.headers ?? {},
            method: request.method ?? "GET",
          })
        );

        const bytes = yield* io(() => response.arrayBuffer());

        return {
          body: once(new Uint8Array(bytes)),
          headers: Object.fromEntries(response.headers.entries()),
          method: request.method,
          statusCode: response.status,
          statusMessage: response.statusText,
          url: response.url === "" ? request.url : response.url,
        } satisfies GitHttpResponse;
      })
    ),
});

/** Why a fetch from `url` brought nothing to import. */
const fetchRefusal = (url: string, cause: unknown) =>
  Match.value(cause).pipe(
    Match.when(Schema.is(FetchFailed), (failed) => failed.reason),
    Match.when(Match.instanceOf(Error), (thrown) => thrown.message),
    Match.orElse(() => "no reason given"),
    (reason) => `${url} could not be fetched: ${reason}`
  );

const make = (options: {
  readonly root: string;
  readonly remoteBase: string;
}) =>
  Effect.gen(function* () {
    const root = options.root.replace(/\/+$/u, "");
    const remoteBase = options.remoteBase.replace(/\/+$/u, "");
    const http = httpOver((yield* Fetch).fetch, yield* Effect.context());
    const locks = new Map<RepoName, Semaphore.Semaphore>();

    yield* io(() => fs.promises.mkdir(root, { recursive: true })).pipe(
      Effect.orDie
    );

    const gitdirOf = (name: RepoName) => `${root}/${name}.git`;

    const createdOf = (name: RepoName): RepoCreated => ({
      name,
      remote: `${remoteBase}/${name}.git`,
    });

    const lockOf = (name: RepoName) =>
      Effect.sync(() => {
        const found = locks.get(name);

        if (found !== undefined) {
          return found;
        }

        const lock = Semaphore.makeUnsafe(1);

        locks.set(name, lock);

        return lock;
      });

    /** The repo's git directory, if the repo exists. */
    const known = (name: RepoName): Effect.Effect<string, RepoNotFound> =>
      Effect.flatMap(exists(gitdirOf(name)), (found) =>
        found
          ? Effect.succeed(gitdirOf(name))
          : Effect.fail(new RepoNotFound({ name }))
      );

    /** A new, empty bare repo; making its directory is what claims the name. */
    const open = (name: RepoName) =>
      Effect.gen(function* () {
        const gitdir = gitdirOf(name);

        const made = yield* io(() => fs.promises.mkdir(gitdir)).pipe(
          Effect.as(true),
          Effect.catchIf(failedWith("EEXIST"), () => Effect.succeed(false)),
          Effect.orDie
        );

        if (!made) {
          return yield* new RepoExists({ name });
        }

        yield* io(() =>
          init({ bare: true, defaultBranch: "main", fs, gitdir })
        ).pipe(Effect.orDie);

        return gitdir;
      });

    /** A new repo `name` holding `source`'s `ref` at `tip`, copied as it stands. */
    const seed = (
      name: RepoName,
      source: PushSource,
      ref: string,
      tip: Option.Option<CommitSha>
    ) =>
      Effect.gen(function* () {
        const gitdir = yield* open(name);

        if (Option.isSome(tip)) {
          yield* copyCommit(source, gitdir, tip.value);
          yield* io(() => writeRef({ fs, gitdir, ref, value: tip.value })).pipe(
            Effect.orDie
          );
        }

        return createdOf(name);
      });

    // Local disk's test-only meaning of a public remote: a bare repo on this
    // machine, copied object by object. Without a branch, it takes the one
    // the repo's HEAD names.
    const importFile = (
      name: RepoName,
      url: string,
      branch: BranchName | undefined
    ) =>
      Effect.gen(function* () {
        const gitdir = fileURLToPath(url);

        const head = yield* unlessMissing(() =>
          currentBranch({ fs, fullname: true, gitdir })
        );

        if (Option.isNone(head)) {
          return yield* new ImportRefused({
            name,
            reason: `no repo at ${url}`,
          });
        }

        // A detached HEAD names no branch to take.
        const ref = branch === undefined ? head.value : `refs/heads/${branch}`;

        if (ref === undefined) {
          return yield* new ImportRefused({
            name,
            reason: `${url} has no default branch`,
          });
        }

        const tip = yield* tipOf(gitdir, ref);

        if (Option.isNone(tip)) {
          return yield* new ImportRefused({
            name,
            reason: `${url} has no branch ${branchOf(ref)}`,
          });
        }

        return yield* seed(name, { fs, gitdir }, ref, tip);
      });

    /** One branch of a smart-HTTP remote, fetched into the empty repo `gitdir`. */
    const fetchInto = (
      name: RepoName,
      gitdir: string,
      url: string,
      branch: BranchName | undefined
    ) =>
      Effect.gen(function* () {
        // isomorphic-git's fetch files what it got under a configured remote's
        // refspec, so the repo has one for as long as the fetch runs.
        yield* io(() =>
          addRemote({ fs, gitdir, remote: importRemote, url })
        ).pipe(Effect.orDie);

        const fetched = yield* io(() =>
          fetchPack({
            fs,
            gitdir,
            http,
            remote: importRemote,
            remoteRef: branch === undefined ? "HEAD" : `refs/heads/${branch}`,
            singleBranch: true,
            tags: false,
          })
        ).pipe(
          Effect.mapError(
            (failure) =>
              new ImportRefused({
                name,
                reason:
                  failure.cause instanceof Errors.NotFoundError
                    ? `${url} has no branch ${branch ?? "HEAD"}`
                    : fetchRefusal(url, failure.cause),
              })
          )
        );

        const ref =
          branch === undefined ? fetched.defaultBranch : `refs/heads/${branch}`;

        const tip = fetched.fetchHead;

        if (tip === null || ref === null) {
          return yield* new ImportRefused({
            name,
            reason: `${url} has no default branch`,
          });
        }

        yield* io(() => writeRef({ fs, gitdir, ref, value: tip })).pipe(
          Effect.orDie
        );
        // No repo here has remotes or remote-tracking refs.
        yield* io(() =>
          deleteRemote({ fs, gitdir, remote: importRemote })
        ).pipe(Effect.orDie);
        yield* removeAll(`${gitdir}/refs/remotes`);

        return createdOf(name);
      });

    // A public remote over smart HTTP, through the `Fetch` this layer was
    // given. A failed import leaves no repo behind.
    const importHttp = (
      name: RepoName,
      url: string,
      branch: BranchName | undefined
    ) =>
      Effect.flatMap(open(name), (gitdir) =>
        fetchInto(name, gitdir, url, branch).pipe(
          Effect.onError(() => removeAll(gitdir).pipe(Effect.asVoid))
        )
      );

    /** The repo's tokens file, read and rewritten under the repo's lock. */
    const updateTokens = <A>(
      name: RepoName,
      change: (tokens: Tokens) => Effect.Effect<readonly [A, Tokens]>
    ) =>
      Effect.gen(function* () {
        const gitdir = yield* known(name);
        const path = `${gitdir}/tokens.json`;
        const lock = yield* lockOf(name);

        return yield* lock.withPermit(
          Effect.gen(function* () {
            const text = yield* io(() =>
              fs.promises.readFile(path, "utf-8")
            ).pipe(
              Effect.asSome,
              Effect.catchIf(failedWith("ENOENT"), () => Effect.succeedNone),
              Effect.orDie
            );

            const stored = Option.isNone(text)
              ? noTokens
              : yield* Schema.decodeEffect(Tokens)(text.value).pipe(
                  Effect.orDie
                );

            const [result, next] = yield* change(stored);

            const written = yield* Schema.encodeEffect(Tokens)(next).pipe(
              Effect.orDie
            );

            yield* io(() => fs.promises.writeFile(path, written)).pipe(
              Effect.orDie
            );

            return result;
          })
        );
      });

    return RepoHost.of({
      create: (name) => open(name).pipe(Effect.as(createdOf(name))),
      // The default branch only, copied as it stands: later pushes to the base
      // or to a sibling never reach this fork.
      fork: (base, name) =>
        Effect.gen(function* () {
          const from = yield* known(base);
          const tip = yield* tipOf(from, mainRef);

          return yield* seed(name, { fs, gitdir: from }, mainRef, tip);
        }),
      importFrom: (name, source) =>
        Effect.gen(function* () {
          if (yield* exists(gitdirOf(name))) {
            return yield* new RepoExists({ name });
          }

          const scheme = URL.canParse(source.url)
            ? new URL(source.url).protocol
            : "";

          return yield* Match.value(scheme).pipe(
            Match.when("file:", () =>
              importFile(name, source.url, source.branch)
            ),
            Match.whenOr("http:", "https:", () =>
              importHttp(name, source.url, source.branch)
            ),
            Match.orElse(() =>
              Effect.fail(
                new ImportRefused({
                  name,
                  reason: `${source.url} is not a file or HTTP URL`,
                })
              )
            )
          );
        }),
      log: (name, at, limit) =>
        Effect.gen(function* () {
          const gitdir = yield* known(name);
          const commits: Commit[] = [];
          let next = yield* resolve(gitdir, at);

          while (Option.isSome(next) && commits.length < limit) {
            const commit = yield* commitAt(gitdir, next.value);

            if (Option.isNone(commit)) {
              break;
            }

            commits.push(commit.value);
            next = Option.fromNullishOr(commit.value.parents[0]);
          }

          return commits;
        }),
      // An id that looks random but is the same for the same repo and count.
      mintToken: (name, scope, ttl) =>
        Effect.gen(function* () {
          const now = yield* DateTime.now;

          const id = yield* updateTokens(name, (tokens) =>
            Effect.gen(function* () {
              const minted = tokens.minted + 1;

              const { oid } = yield* io(() =>
                hashBlob({ object: `${name}\n${minted}` })
              ).pipe(Effect.orDie);

              return [oid, { live: [...tokens.live, oid], minted }] as const;
            })
          );

          return {
            expiresAt: DateTime.addDuration(now, ttl),
            id,
            scope,
            secret: Redacted.make(`local-${id}`),
          };
        }),
      push: (name, source, updates) =>
        Effect.gen(function* () {
          const gitdir = yield* known(name);
          const lock = yield* lockOf(name);

          return yield* lock.withPermit(
            Effect.forEach(updates, (update) => apply(gitdir, source, update))
          );
        }),
      // Only a blob by its own id: no tag or commit is peeled to one.
      readBlob: (name, blob) =>
        Effect.gen(function* () {
          const gitdir = yield* known(name);

          const read = yield* unlessMissing(() =>
            readBlob({ fs, gitdir, oid: blob })
          );

          return Option.flatMap(read, ({ blob: bytes, oid }) =>
            oid === blob ? Option.some(bytes) : Option.none()
          );
        }),
      readCommit: (name, sha) =>
        known(name).pipe(Effect.flatMap((gitdir) => commitAt(gitdir, sha))),
      readFile: (name, at, path) =>
        Effect.gen(function* () {
          const gitdir = yield* known(name);
          const sha = yield* resolve(gitdir, at);

          if (Option.isNone(sha)) {
            return Option.none();
          }

          const blob = yield* unlessMissing(() =>
            readBlob({ filepath: path, fs, gitdir, oid: sha.value })
          );

          return Option.map(blob, ({ blob: bytes }) => bytes);
        }),
      // Only a tree by its own id: isomorphic-git peels a commit to its tree.
      readTree: (name, tree) =>
        Effect.gen(function* () {
          const gitdir = yield* known(name);

          const read = yield* unlessMissing(() =>
            readTree({ fs, gitdir, oid: tree })
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
          const gitdir = yield* known(name);

          const names = yield* io(() =>
            listRefs({ filepath: "refs", fs, gitdir })
          ).pipe(Effect.orDie);

          const listed = yield* Effect.forEach(names, (relative) =>
            Effect.gen(function* () {
              const ref = RefName.make(`refs/${relative}`);
              const tip = yield* tipOf(gitdir, ref);

              return Option.map(tip, (sha) => [ref, sha] as const);
            })
          );

          return new Map(Array.getSomes(listed));
        }),
      remote: (name) => known(name).pipe(Effect.as(createdOf(name).remote)),
      remove: (name) => removeAll(gitdirOf(name)),
      revokeToken: (name, id) =>
        updateTokens(name, (tokens) =>
          Effect.succeed(
            tokens.live.includes(id)
              ? ([
                  true,
                  {
                    ...tokens,
                    live: tokens.live.filter((live) => live !== id),
                  },
                ] as const)
              : ([false, tokens] as const)
          )
        ),
    });
  });

/**
 * Artifacts on local disk, for tests that need real git over HTTP and for the
 * CLI's dev mode: each repo a bare git repo `<root>/<name>.git` with default
 * branch `main`, kept across layers over the same root. A push is a
 * compare-and-swap per ref with no atomicity across refs, as S1 found
 * Artifacts. `remote(name)` is `<remoteBase>/<name>.git`, so a test can serve
 * `root` with `git http-backend` under that base and drive real git at it.
 * Tokens are recorded, never checked.
 */
export const RepoHostLocal = {
  layer: (options: {
    readonly root: string;
    readonly remoteBase: string;
  }): Layer.Layer<RepoHost, never, Fetch> =>
    Layer.effect(RepoHost, make(options)),
  /**
   * A new, empty directory for a store, deleted with everything in it when
   * the scope closes: a root for callers with no file system of their own,
   * such as this package's tests.
   */
  temporaryRoot: Effect.acquireRelease(
    io(() => fs.promises.mkdtemp(`${tmpdir()}/repo-host-`)).pipe(Effect.orDie),
    (root) =>
      io(() => fs.promises.rm(root, { force: true, recursive: true })).pipe(
        Effect.orDie
      )
  ) satisfies Effect.Effect<string, never, Scope.Scope>,
};
