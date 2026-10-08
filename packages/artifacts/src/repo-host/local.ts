import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

import type { CommitSha } from "@repo/protocol/ids";
import {
  Data,
  DateTime,
  Effect,
  Layer,
  Match,
  Option,
  Redacted,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import type { Context } from "effect";
import {
  Errors,
  addRemote,
  currentBranch,
  deleteRemote,
  fetch as fetchPack,
  hashBlob,
  writeRef,
} from "isomorphic-git";
import type {
  GitHttpRequest,
  GitHttpResponse,
  HttpClient,
} from "isomorphic-git";

import { Fetch, FetchFailed } from "../fetch.ts";
import {
  ImportRefused,
  RepoExists,
  RepoHost,
  RepoNotFound,
} from "../repo-host.ts";
import type {
  BranchName,
  PushSource,
  RepoCreated,
  RepoName,
} from "../repo-host.ts";
import {
  initBare,
  mainRef,
  objectsAndRefs,
  seedRef,
  tipOf,
  unlessMissing,
} from "./isogit-store.ts";
import type { GitDir } from "./isogit-store.ts";

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

/** The remote an HTTP import fetches through, removed once it has. */
const importRemote = "import";

const branchOf = (ref: string) => ref.replace(/^refs\/heads\//u, "");

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

    const dirOf = (name: RepoName): GitDir => ({
      fs,
      gitdir: `${root}/${name}.git`,
    });

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

    /** The repo's directory and lock, if the repo exists. */
    const known = (name: RepoName) =>
      Effect.gen(function* () {
        const dir = dirOf(name);

        if (!(yield* exists(dir.gitdir))) {
          return yield* new RepoNotFound({ name });
        }

        return { dir, lock: yield* lockOf(name) };
      });

    /** A new, empty bare repo; making its directory is what claims the name. */
    const open = (name: RepoName) =>
      Effect.gen(function* () {
        const dir = dirOf(name);

        const made = yield* io(() => fs.promises.mkdir(dir.gitdir)).pipe(
          Effect.as(true),
          Effect.catchIf(failedWith("EEXIST"), () => Effect.succeed(false)),
          Effect.orDie
        );

        if (!made) {
          return yield* new RepoExists({ name });
        }

        yield* initBare(dir);

        return dir;
      });

    /** A new repo `name` holding `source`'s `ref` at `tip`, copied as it stands. */
    const seed = (
      name: RepoName,
      source: PushSource,
      ref: string,
      tip: Option.Option<CommitSha>
    ) =>
      Effect.gen(function* () {
        yield* seedRef(source, yield* open(name), ref, tip);

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
        const noRepo = new ImportRefused({ name, reason: `no repo at ${url}` });

        // A file URL that names another host is no path on this machine.
        const gitdir = yield* Effect.try({
          catch: () => noRepo,
          try: () => fileURLToPath(url),
        });

        const head = yield* unlessMissing(() =>
          currentBranch({ fs, fullname: true, gitdir })
        );

        if (Option.isNone(head)) {
          return yield* noRepo;
        }

        // A detached HEAD names no branch to take.
        const ref = branch === undefined ? head.value : `refs/heads/${branch}`;

        if (ref === undefined) {
          return yield* new ImportRefused({
            name,
            reason: `${url} has no default branch`,
          });
        }

        const tip = yield* tipOf({ fs, gitdir }, ref);

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
      Effect.flatMap(open(name), ({ gitdir }) =>
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
        const { dir, lock } = yield* known(name);
        const path = `${dir.gitdir}/tokens.json`;

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
      ...objectsAndRefs(known),
      create: (name) => open(name).pipe(Effect.as(createdOf(name))),
      // The default branch only, copied as it stands: later pushes to the base
      // or to a sibling never reach this fork.
      fork: (base, name) =>
        Effect.gen(function* () {
          const { dir } = yield* known(base);
          const tip = yield* tipOf(dir, mainRef);

          return yield* seed(name, dir, mainRef, tip);
        }),
      importFrom: (name, source) =>
        Effect.gen(function* () {
          if (yield* exists(dirOf(name).gitdir)) {
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
      remote: (name) => known(name).pipe(Effect.as(createdOf(name).remote)),
      remove: (name) => removeAll(dirOf(name).gitdir),
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
 * compare-and-swap per ref with no atomicity across refs, as probes found
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
};
