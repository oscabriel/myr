// The token goes only into the `Authorization` header of requests to the
// remote's own origin; everywhere else it stays `Redacted`.
import { CommitSha } from "@repo/protocol/ids";
import {
  Data,
  Effect,
  FiberSet,
  Match,
  Option,
  Redacted,
  Schema,
  Stream,
} from "effect";
import type { Array } from "effect";
import {
  Errors,
  addRemote,
  deleteRef,
  deleteRemote,
  fetch as fetchPack,
  init,
  listRefs as localRefs,
  listServerRefs,
  push,
} from "isomorphic-git";
import type {
  FsClient,
  GitHttpRequest,
  GitHttpResponse,
  HttpClient,
} from "isomorphic-git";

import { Fetch } from "../fetch.ts";
import {
  HostBusy,
  RefName,
  RefOutcome,
  RepoName,
  RepoNotFound,
} from "../repo-host.ts";
import type { PushSource, RefUpdate, Tag } from "../repo-host.ts";

class GitFailure extends Data.TaggedError("GitFailure")<{
  readonly cause: unknown;
}> {}

/** isomorphic-git's no-commit id: a ref that is absent. */
const ABSENT = "0".repeat(40);

// What a receive-pack says when a ref moved under a push: Artifacts,
// git's own receive-pack (2.56), and a server set to refuse rewinding a ref.
// `fetch first` is git's client-side word and never reaches a server.
const MOVED = ["stale ref", "incorrect old value provided", "non-fast-forward"];

// Artifacts' whole reply to a push it is too busy for: one side-band 3
// (fatal) packet and no report.
const BUSY = "artifacts_git_receive_pack_busy";

// The remote names isomorphic-git files a push's and a fetch's tracking refs
// under; each is removed again, so a source keeps no trace of the store.
const PUSH_REMOTE = "repo-host-push";

const FETCH_REMOTE = "repo-host-fetch";

const decodeRepo = Schema.decodeUnknownOption(RepoName);

const decodeRef = Schema.decodeUnknownOption(RefName);

const decodeSha = Schema.decodeUnknownOption(CommitSha);

const repoOf = (remote: string) =>
  Option.match(
    decodeRepo(
      (URL.canParse(remote) ? new URL(remote).pathname : remote)
        .replace(/\/+$/u, "")
        .split("/")
        .at(-1)
        ?.replace(/\.git$/u, "")
    ),
    {
      onNone: () => Effect.die(`${remote} names no repo as <name>.git`),
      onSome: Effect.succeed,
    }
  );

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
    ? Stream.fromAsyncIterable(body, (cause) => new GitFailure({ cause }))
    : Stream.fromIterable(body)
  ).pipe(Stream.runCollect, Effect.map(concat));

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

const fatalMessages = (bytes: Uint8Array) => {
  const messages: string[] = [];
  const text = new TextDecoder();
  let at = 0;

  while (at + 4 <= bytes.length) {
    const length = Number.parseInt(text.decode(bytes.slice(at, at + 4)), 16);

    if (Number.isNaN(length)) {
      break;
    }

    if (length < 4) {
      at += 4;
      continue;
    }

    if (bytes[at + 4] === 3) {
      messages.push(text.decode(bytes.slice(at + 5, at + length)));
    }

    at += length;
  }

  return messages;
};

const isReceivePack = (url: string) =>
  new URL(url).pathname.endsWith("/git-receive-pack");

const httpFor = (remote: string, token: Redacted.Redacted, name: RepoName) =>
  Effect.gen(function* () {
    const run = yield* FiberSet.makeRuntimePromise<Fetch>();
    const { origin } = new URL(remote);

    const exchange = (request: GitHttpRequest) =>
      Effect.gen(function* () {
        const headers = new Headers(request.headers ?? {});

        if (new URL(request.url).origin === origin) {
          headers.set("authorization", `Bearer ${Redacted.value(token)}`);
        }

        const method = request.method ?? "GET";

        const response = yield* (yield* Fetch).fetch(
          request.body === undefined
            ? new Request(request.url, { headers, method })
            : new Request(request.url, {
                body: yield* bytesOf(request.body),
                headers,
                method,
              })
        );

        // ASSUMPTION: Artifacts answers 404 for a repo it lacks, as `git
        // http-backend` does.
        if (response.status === 404) {
          return yield* new RepoNotFound({ name });
        }

        const bytes = new Uint8Array(
          yield* Effect.tryPromise({
            catch: (cause) => new GitFailure({ cause }),
            try: () => response.arrayBuffer(),
          })
        );

        if (
          isReceivePack(request.url) &&
          fatalMessages(bytes).some((message) => message.includes(BUSY))
        ) {
          return yield* new HostBusy({ name });
        }

        return {
          body: once(bytes),
          headers: Object.fromEntries(response.headers.entries()),
          method: request.method,
          statusCode: response.status,
          statusMessage: response.statusText,
          url: response.url === "" ? request.url : response.url,
        } satisfies GitHttpResponse;
      });

    return {
      request: (request: GitHttpRequest) => run(exchange(request)),
    } satisfies HttpClient;
  });

/**
 * The typed errors come back as new values: isomorphic-git stamps a `caller`
 * onto what it rethrows.
 */
const git = <A>(run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    catch: (cause) =>
      Match.value(cause).pipe(
        Match.when(
          Schema.is(RepoNotFound),
          ({ name }) => new RepoNotFound({ name })
        ),
        Match.when(Schema.is(HostBusy), ({ name }) => new HostBusy({ name })),
        Match.orElse(() => new GitFailure({ cause }))
      ),
    try: run,
  });

const refsAt = (remote: string, http: HttpClient) =>
  git(() => listServerRefs({ http, protocolVersion: 1, url: remote })).pipe(
    Effect.catchTags({
      GitFailure: ({ cause }) => Effect.die(cause),
      // Only a push is ever busy.
      HostBusy: Effect.die,
    }),
    Effect.map(
      (refs) =>
        new Map(
          refs.flatMap(({ oid, ref }) =>
            Option.match(Option.all([decodeRef(ref), decodeSha(oid)]), {
              onNone: () => [],
              onSome: (pair) => [pair],
            })
          )
        )
    )
  );

/** Peeled by the `^{}` line protocol v1 advertises after an annotated tag, else the tag's own target. */
const tagsAt = (remote: string, http: HttpClient) =>
  git(() =>
    listServerRefs({
      http,
      peelTags: true,
      prefix: "refs/tags/",
      protocolVersion: 1,
      url: remote,
    })
  ).pipe(
    Effect.catchTags({
      GitFailure: ({ cause }) => Effect.die(cause),
      HostBusy: Effect.die,
    }),
    Effect.map((refs) =>
      refs.flatMap(({ oid, peeled, ref }) =>
        Option.match(Option.all([decodeRef(ref), decodeSha(peeled ?? oid)]), {
          onNone: () => [],
          onSome: ([name, sha]) => [{ name, sha }],
        })
      )
    )
  );

export const listTags = (
  remote: string,
  token: Redacted.Redacted
): Effect.Effect<readonly Tag[], RepoNotFound, Fetch> =>
  Effect.scoped(
    Effect.gen(function* () {
      const name = yield* repoOf(remote);

      return yield* tagsAt(remote, yield* httpFor(remote, token, name));
    })
  );

export const listRefs = (
  remote: string,
  token: Redacted.Redacted
): Effect.Effect<ReadonlyMap<RefName, CommitSha>, RepoNotFound, Fetch> =>
  Effect.scoped(
    Effect.gen(function* () {
      const name = yield* repoOf(remote);

      return yield* refsAt(remote, yield* httpFor(remote, token, name));
    })
  );

const isMoved = (reason: string) =>
  MOVED.some((moved) => reason.includes(moved));

const refusedAsMoved = ({ cause }: GitFailure, ref: RefName) =>
  cause instanceof Errors.GitPushError &&
  isMoved(cause.data.result.refs[ref]?.error ?? "");

/**
 * One ref's compare-and-swap: the push's own ref discovery is the check, so
 * it stops before any pack is built if the tip is not `from`. `to` need not
 * descend from `from` (Artifacts takes such an update), so isomorphic-git's
 * fast-forward test is off (`force`).
 */
const pushOne = (
  remote: string,
  http: HttpClient,
  source: PushSource,
  update: RefUpdate
) =>
  Effect.gen(function* () {
    const expected = Option.getOrElse(update.from, () => ABSENT);
    let found = ABSENT;

    const pushed = yield* git((signal) =>
      push({
        ...source,
        force: true,
        http,
        onPrePush: ({ remoteRef }) => {
          found = remoteRef.oid;

          return found === expected;
        },
        ref: update.to,
        remote: PUSH_REMOTE,
        remoteRef: update.ref,
        signal,
        url: remote,
      })
    ).pipe(
      Effect.as(RefOutcome.Updated({ ref: update.ref })),
      Effect.catchTag("GitFailure", (failure) =>
        Match.value(failure).pipe(
          Match.when(
            ({ cause }) => cause instanceof Errors.UserCanceledError,
            () =>
              Effect.succeed(
                RefOutcome.Stale({
                  ref: update.ref,
                  tip: Option.filter(decodeSha(found), (sha) => sha !== ABSENT),
                })
              )
          ),
          Match.when(
            (refused) => refusedAsMoved(refused, update.ref),
            () =>
              refsAt(remote, http).pipe(
                Effect.map((refs) =>
                  RefOutcome.Stale({
                    ref: update.ref,
                    tip: Option.fromNullishOr(refs.get(update.ref)),
                  })
                )
              )
          ),
          Match.orElse(({ cause }) => Effect.die(cause))
        )
      )
    );

    // isomorphic-git files a pushed ref under the push's remote in the source.
    yield* git(() =>
      deleteRef({
        ...source,
        ref: `refs/remotes/${PUSH_REMOTE}/${update.ref.replace(/^refs\/heads\//u, "")}`,
      })
    ).pipe(Effect.ignore);

    return pushed;
  });

/**
 * One ref per push, since Artifacts has no atomic push. A busy store fails the
 * whole call with `HostBusy`, and refs before the busy one may have moved.
 */
export const pushRefs = (input: {
  readonly remote: string;
  readonly token: Redacted.Redacted;
  readonly source: PushSource;
  readonly updates: Array.NonEmptyReadonlyArray<RefUpdate>;
}): Effect.Effect<readonly RefOutcome[], RepoNotFound | HostBusy, Fetch> =>
  Effect.scoped(
    Effect.gen(function* () {
      const name = yield* repoOf(input.remote);
      const http = yield* httpFor(input.remote, input.token, name);

      return yield* Effect.forEach(input.updates, (update) =>
        pushOne(input.remote, http, input.source, update)
      );
    })
  );

export const fetchInto = (input: {
  readonly remote: string;
  readonly token: Redacted.Redacted;
  readonly fs: FsClient;
  readonly gitdir: string;
  readonly ref: string;
  readonly depth?: number;
}): Effect.Effect<Option.Option<CommitSha>, RepoNotFound, Fetch> =>
  Effect.scoped(
    Effect.gen(function* () {
      const name = yield* repoOf(input.remote);
      const http = yield* httpFor(input.remote, input.token, name);
      const repo = { fs: input.fs, gitdir: input.gitdir };

      yield* git(() => init({ ...repo, bare: true })).pipe(Effect.orDie);

      // isomorphic-git files what it fetched under a configured remote's
      // refspec, so the repo has one, and its tracking refs, for as long as
      // the fetch runs.
      yield* Effect.acquireRelease(
        git(() =>
          addRemote({
            ...repo,
            force: true,
            remote: FETCH_REMOTE,
            url: input.remote,
          })
        ).pipe(Effect.orDie),
        () =>
          Effect.gen(function* () {
            const tracking = yield* git(() =>
              localRefs({ ...repo, filepath: `refs/remotes/${FETCH_REMOTE}` })
            );

            yield* Effect.forEach(tracking, (ref) =>
              git(() =>
                deleteRef({
                  ...repo,
                  ref: `refs/remotes/${FETCH_REMOTE}/${ref}`,
                })
              )
            );
            yield* git(() => deleteRemote({ ...repo, remote: FETCH_REMOTE }));
          }).pipe(Effect.ignore)
      );

      return yield* git(() =>
        fetchPack({
          ...repo,
          depth: input.depth,
          http,
          remote: FETCH_REMOTE,
          remoteRef: input.ref,
          singleBranch: true,
          tags: false,
        })
      ).pipe(
        Effect.map(({ fetchHead }) => decodeSha(fetchHead)),
        Effect.catchTags({
          GitFailure: ({ cause }) =>
            cause instanceof Errors.NotFoundError
              ? Effect.succeedNone
              : Effect.die(cause),
          // Only a push is ever busy.
          HostBusy: Effect.die,
        })
      );
    })
  );
