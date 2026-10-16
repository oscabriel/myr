/**
 * The binding's surprises, found by probing it live:
 *
 * - errors are read by `code`, and by message when there is none, as under
 *   `wrangler dev` remote bindings;
 * - a fork that answers 500 is tried once more, and an already-exists or a
 *   second 500 after that may be the fork the first made: it is, if it lists
 *   `main`;
 * - reads name a branch by its short name and a commit by its id, never
 *   `refs/…`, so `refs` and `push` go over git smart HTTP instead;
 * - a rate-limited call (2,000 requests per 10 s per repo) is retried.
 *
 * The write token a create, fork or import hands back is revoked at once:
 * any write token can force-push `main`, and no caller needs it.
 */
import {
  Data,
  DateTime,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Predicate,
  Redacted,
  Schedule,
  Schema,
} from "effect";

import { Fetch } from "../fetch.ts";
import {
  Commit,
  ForkInProgress,
  ImportRefused,
  RefName,
  RepoExists,
  RepoHost,
  RepoNotFound,
  RepoSession,
  TreeEntry,
} from "../repo-host.ts";
import type {
  RepoName,
  RepoToken,
  TokenScope,
  Revision,
} from "../repo-host.ts";
import {
  isCode,
  LOG_PAGE,
  NO_SOURCE,
  refOf,
  secondsOf,
} from "./artifacts-api.ts";
import type { Code } from "./artifacts-api.ts";
import { listRefs, listTags, pushRefs } from "./smart-http.ts";

const MESSAGES = [
  [/not found/iu, "NOT_FOUND"],
  [/already exists/iu, "ALREADY_EXISTS"],
  [/fork[_ ]in[_ ]progress|still forking/iu, "FORK_IN_PROGRESS"],
  [/internal error/iu, "INTERNAL_ERROR"],
] as const satisfies readonly (readonly [RegExp, Code])[];

class Thrown extends Data.TaggedError("Thrown")<{
  readonly code: Option.Option<Code>;
  readonly message: string;
  readonly error: unknown;
}> {}

class MaybeForked extends Data.TaggedError("MaybeForked")<{
  readonly thrown: Thrown;
}> {}

/**
 * ASSUMPTION: no rate-limit refusal has been seen live and its error codes
 * list none, so it is read from a code or a message that names the limit.
 */
const RATE_LIMITED = /rate[ _-]?limit|too[ _-]many[ _-]requests/iu;

const isRateLimited = ({ error, message }: Thrown) =>
  RATE_LIMITED.test(message) ||
  (Predicate.hasProperty(error, "code") &&
    Predicate.isString(error.code) &&
    RATE_LIMITED.test(error.code));

const whileLimited = Schedule.exponential(Duration.millis(250)).pipe(
  Schedule.setInputType<Thrown>(),
  Schedule.while(
    ({ attempt: asked, input }) => asked <= 4 && isRateLimited(input)
  )
);

const tried = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (error) => {
      const message = error instanceof Error ? error.message : String(error);

      const code =
        Predicate.hasProperty(error, "code") && isCode(error.code)
          ? Option.some(error.code)
          : Option.fromNullishOr(
              MESSAGES.find(([pattern]) => pattern.test(message))?.[1]
            );

      return new Thrown({ code, error, message });
    },
    try: run,
  }).pipe(Effect.retry(whileLimited));

/**
 * Workers RPC puts a `Symbol.dispose` on every object a call returns, and
 * where the service's own result carried a disposer, its call stays open until
 * that is called: a result left to the garbage collector draws the runtime's
 * "An RPC result was not disposed properly". Every result but a repo's handle
 * is data, whole once it arrives, so each is disposed as soon as it lands.
 */
const disposed = <A>(result: A): Effect.Effect<A> =>
  Effect.try(() => {
    const dispose = Predicate.hasProperty(result, Symbol.dispose)
      ? result[Symbol.dispose]
      : undefined;

    if (Predicate.isFunction(dispose)) {
      dispose.call(result);
    }
  }).pipe(Effect.ignore, Effect.as(result));

/** A call whose result is data: the handle alone is kept, by `withRepo`. */
const attempt = <A>(run: () => Promise<A>) =>
  tried(run).pipe(Effect.flatMap(disposed));

const threw =
  (code: Code) =>
  (thrown: Thrown): boolean =>
    Option.contains(thrown.code, code);

const fromArtifactsError = (
  name: RepoName,
  thrown: Thrown
): Effect.Effect<never, RepoNotFound | RepoExists | ForkInProgress> =>
  Match.value(thrown).pipe(
    Match.when(threw("NOT_FOUND"), () =>
      Effect.fail(new RepoNotFound({ name }))
    ),
    Match.when(threw("ALREADY_EXISTS"), () =>
      Effect.fail(new RepoExists({ name }))
    ),
    Match.when(threw("FORK_IN_PROGRESS"), () =>
      Effect.fail(new ForkInProgress({ name }))
    ),
    Match.orElse(({ error }) => Effect.die(error))
  );

const call = <A>(name: RepoName, run: () => Promise<A>) =>
  attempt(run).pipe(
    Effect.catchTag("Thrown", (thrown) => fromArtifactsError(name, thrown))
  );

const asDefect = ({ error }: Thrown) => Effect.die(error);

const onlyNotFound = <A, R>(
  effect: Effect.Effect<A, RepoNotFound | RepoExists | ForkInProgress, R>
) =>
  effect.pipe(
    Effect.catchTags({ ForkInProgress: Effect.die, RepoExists: Effect.die })
  );

const main = RefName.make("refs/heads/main");

const CALL_TOKEN_TTL = Duration.minutes(5);

const IMPORT_REFUSALS: ReadonlySet<Code> = new Set(NO_SOURCE);

const bytesOf = (blob: Blob) =>
  attempt(() => blob.arrayBuffer()).pipe(
    Effect.map((buffer) => new Uint8Array(buffer)),
    Effect.catchTag("Thrown", asDefect)
  );

const decodeCommit = Schema.decodeUnknownEffect(Commit);

const decodeEntries = Schema.decodeUnknownEffect(Schema.Array(TreeEntry));

const commitOf = (metadata: ArtifactsCommitMetadata) =>
  decodeCommit({
    author: metadata.author,
    authoredAt: metadata.authoredAt,
    committedAt: metadata.committedAt,
    committer: metadata.committer,
    message: metadata.message,
    parents: metadata.parents,
    sha: metadata.hash,
    tree: metadata.treeHash,
  }).pipe(Effect.orDie);

// Artifacts gives canonical modes: a folder is `40000`, as git stores it, not
// `040000`, as `ls-tree` prints it and the port has it.
const entriesOf = (entries: readonly ArtifactsTreeEntry[]) =>
  decodeEntries(
    entries.map((entry) => {
      const mode = entry.mode.padStart(6, "0");

      return {
        mode,
        name: entry.name,
        sha: entry.hash,
        type: Match.value(mode).pipe(
          Match.when("040000", () => "tree"),
          Match.when("160000", () => "commit"),
          Match.orElse(() => "blob")
        ),
      };
    })
  ).pipe(Effect.orDie);

/** An import copies a whole history and may outlast `import()` itself. */
const asksWhileMaking = (thrown: Thrown) =>
  Match.value(thrown).pipe(
    Match.when(threw("CREATE_IN_PROGRESS"), () => 7),
    Match.when(threw("IMPORT_IN_PROGRESS"), () => 16),
    Match.orElse(() => 0)
  );

const whileMaking = Schedule.min([
  Schedule.exponential(Duration.millis(250)),
  Schedule.spaced(Duration.seconds(16)),
]).pipe(
  Schedule.setInputType<Thrown>(),
  Schedule.while(({ attempt: asked, input }) => asked <= asksWhileMaking(input))
);

const handleOf = (binding: Artifacts, name: RepoName) =>
  tried(() => binding.get(name)).pipe(
    Effect.retry(whileMaking),
    Effect.catchTag("Thrown", (thrown) => fromArtifactsError(name, thrown))
  );

/** The binding's handles are RPC stubs, so each is disposed. */
const disposeOf = (repo: ArtifactsRepo) =>
  Effect.sync(() => {
    repo[Symbol.dispose]();
  });

const withRepo = <A, E, R>(
  binding: Artifacts,
  name: RepoName,
  use: (repo: ArtifactsRepo) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.acquireRelease(handleOf(binding, name), disposeOf).pipe(
      Effect.flatMap(use)
    )
  );

/**
 * The initial write token is revoked: no caller needs it. A failed revoke is
 * logged, never the call's failure: the repo was made.
 */
const withoutToken = (
  binding: Artifacts,
  made: { readonly remote: string; readonly token: string },
  name: RepoName
) =>
  withRepo(binding, name, (repo) =>
    attempt(() => repo.revokeToken(made.token))
  ).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("the initial write token was not revoked", {
        cause: String(cause).replaceAll(made.token, "<token>"),
        repo: name,
      })
    ),
    Effect.as({ name, remote: made.remote })
  );

const access = (name: RepoName, repo: ArtifactsRepo, scope: TokenScope) =>
  Effect.gen(function* () {
    const { remote } = yield* call(name, () => repo.info());

    const token = yield* Effect.acquireRelease(
      call(name, () => repo.createToken(scope, secondsOf(CALL_TOKEN_TTL))),
      ({ id }) => attempt(() => repo.revokeToken(id)).pipe(Effect.ignore)
    );

    return { remote, token: Redacted.make(token.plaintext) };
  });

const refsOf = (name: RepoName, repo: ArtifactsRepo) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { remote, token } = yield* access(name, repo, "read");

      return yield* listRefs(remote, token);
    })
  );

/** Over smart HTTP: the binding lists no refs. */
const tagsOf = (name: RepoName, repo: ArtifactsRepo) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { remote, token } = yield* access(name, repo, "read");

      return yield* listTags(remote, token);
    })
  );

/**
 * After a 500 and then an already-exists or a second 500, the fork may be
 * made: it is, if it lists `main`.
 */
const confirmed = (binding: Artifacts, name: RepoName) =>
  withRepo(binding, name, (repo) =>
    Effect.gen(function* () {
      const refs = yield* refsOf(name, repo);

      if (!refs.has(main)) {
        return yield* new ForkInProgress({ name });
      }

      const { remote } = yield* call(name, () => repo.info());

      return { name, remote };
    })
  ).pipe(
    Effect.catchTags({
      RepoExists: Effect.die,
      RepoNotFound: () => Effect.fail(new ForkInProgress({ name })),
    })
  );

const forkOnce = (binding: Artifacts, base: RepoName, name: RepoName) =>
  withRepo(binding, base, (repo) =>
    attempt(() => repo.fork(name)).pipe(
      Effect.catchTag("Thrown", (thrown) =>
        Match.value(thrown).pipe(
          Match.when(threw("INTERNAL_ERROR"), () =>
            Effect.fail(new MaybeForked({ thrown }))
          ),
          Match.when(threw("NOT_FOUND"), () =>
            Effect.fail(new RepoNotFound({ name: base }))
          ),
          Match.orElse(() => fromArtifactsError(name, thrown))
        )
      )
    )
  ).pipe(Effect.flatMap((made) => withoutToken(binding, made, name)));

/** `readBlob` answers `null` for any other kind, and `readCommit` throws for a non-commit. */
const blobOrCommit = (name: RepoName, repo: ArtifactsRepo, id: string) =>
  call(name, () => repo.readBlob(id)).pipe(
    Effect.flatMap((blob) =>
      blob === null
        ? attempt(() => repo.readCommit(id)).pipe(
            Effect.map((commit) => commit !== null),
            Effect.catchIf(threw("INTERNAL_ERROR"), () =>
              Effect.succeed(false)
            ),
            Effect.catchTag("Thrown", (thrown) =>
              fromArtifactsError(name, thrown)
            )
          )
        : Effect.succeed(true)
    )
  );

/** Artifacts throws `INTERNAL_ERROR` for an object that is no tree (workers-types). */
const treeAt = (name: RepoName, repo: ArtifactsRepo, tree: string) =>
  attempt(() => repo.readTree(tree)).pipe(
    Effect.flatMap((found) =>
      found === null ? Effect.succeedNone : Effect.asSome(entriesOf(found))
    ),
    Effect.catchIf(threw("INTERNAL_ERROR"), ({ error }) =>
      blobOrCommit(name, repo, tree).pipe(
        Effect.flatMap((other) =>
          other ? Effect.succeedNone : Effect.die(error)
        )
      )
    ),
    Effect.catchTag("Thrown", (thrown) => fromArtifactsError(name, thrown))
  );

const importFrom = (
  binding: Artifacts,
  name: RepoName,
  source: { readonly url: string; readonly branch?: string }
) =>
  attempt(() =>
    binding.import({
      source:
        source.branch === undefined
          ? { url: source.url }
          : { branch: source.branch, url: source.url },
      target: { name },
    })
  ).pipe(
    Effect.catchTag("Thrown", (thrown) =>
      Match.value(thrown).pipe(
        Match.when(threw("ALREADY_EXISTS"), () =>
          Effect.fail(new RepoExists({ name }))
        ),
        Match.when(
          ({ code }) =>
            Option.exists(code, (refused) => IMPORT_REFUSALS.has(refused)),
          ({ message }) =>
            Effect.fail(new ImportRefused({ name, reason: message }))
        ),
        Match.orElse(asDefect)
      )
    ),
    Effect.flatMap((made) => withoutToken(binding, made, name))
  );

const log = (
  name: RepoName,
  repo: ArtifactsRepo,
  at: Revision,
  limit: number,
  offset: number
) =>
  Effect.gen(function* () {
    const ref = refOf(at);
    const commits: Commit[] = [];

    while (commits.length < limit) {
      const asked = Math.min(limit - commits.length, LOG_PAGE);

      const page = yield* call(name, () =>
        repo.log({ limit: asked, offset: offset + commits.length, ref })
      );

      for (const metadata of page) {
        commits.push(yield* commitOf(metadata));
      }

      if (page.length < asked) {
        break;
      }
    }

    return commits;
  });

const mintToken = (
  name: RepoName,
  repo: ArtifactsRepo,
  scope: TokenScope,
  ttl: Duration.Duration
) =>
  Effect.gen(function* () {
    const seconds = secondsOf(ttl);
    const now = yield* DateTime.now;
    const token = yield* call(name, () => repo.createToken(scope, seconds));
    const asked = DateTime.add(now, { seconds });

    // Never later than either clock says: the ttl asked for, from before the
    // call, or the store's own expiry.
    const expiresAt = Option.match(DateTime.make(token.expiresAt), {
      onNone: () => asked,
      onSome: (stated) => DateTime.min(asked, stated),
    });

    return {
      expiresAt,
      id: token.id,
      scope,
      secret: Redacted.make(token.plaintext),
    } satisfies RepoToken;
  });

const make = (binding: Artifacts) =>
  Effect.gen(function* () {
    // The service alone: the layer's whole context would carry its Scope, and
    // every call's finalizers would wait for the layer's end.
    const fetch = yield* Fetch;

    const read = <A>(
      name: RepoName,
      use: (
        repo: ArtifactsRepo
      ) => Effect.Effect<A, RepoNotFound | RepoExists | ForkInProgress, Fetch>
    ) =>
      Effect.gen(function* () {
        const session = yield* RepoSession;

        return yield* Option.match(session, {
          onNone: () => withRepo(binding, name, use),
          onSome: ({ hold }) =>
            Effect.flatMap(
              hold(
                `binding:${name}`,
                Effect.acquireRelease(handleOf(binding, name), disposeOf)
              ),
              use
            ),
        });
      }).pipe(onlyNotFound, Effect.provideService(Fetch, fetch));

    return RepoHost.of({
      create: (name) =>
        call(name, () => binding.create(name)).pipe(
          Effect.flatMap((made) => withoutToken(binding, made, name)),
          Effect.catchTags({
            ForkInProgress: Effect.die,
            RepoNotFound: Effect.die,
          })
        ),
      // A 500 is tried once more; an already-exists or a second 500 after
      // it may be the fork the first made, so it is confirmed, not trusted.
      fork: (base, name) =>
        forkOnce(binding, base, name).pipe(
          Effect.catchTag("MaybeForked", () =>
            forkOnce(binding, base, name).pipe(
              Effect.catchTags({
                MaybeForked: () => confirmed(binding, name),
                RepoExists: () => confirmed(binding, name),
              })
            )
          ),
          Effect.provideService(Fetch, fetch)
        ),
      importFrom: (name, source) => importFrom(binding, name, source),
      log: (name, at, limit, offset = 0) =>
        read(name, (repo) => log(name, repo, at, limit, offset)),
      mintToken: (name, scope, ttl) =>
        read(name, (repo) => mintToken(name, repo, scope, ttl)),
      push: (name, source, updates) =>
        withRepo(binding, name, (repo) =>
          Effect.scoped(
            Effect.gen(function* () {
              const { remote, token } = yield* access(name, repo, "write");

              return yield* pushRefs({ remote, source, token, updates });
            })
          )
        ).pipe(
          Effect.catchTags({
            ForkInProgress: Effect.die,
            RepoExists: Effect.die,
          }),
          Effect.provideService(Fetch, fetch)
        ),
      readBlob: (name, blob) =>
        read(name, (repo) =>
          call(name, () => repo.readBlob(blob)).pipe(
            Effect.flatMap((found) =>
              found === null
                ? Effect.succeedNone
                : Effect.asSome(bytesOf(found))
            )
          )
        ),
      readCommit: (name, sha) =>
        read(name, (repo) =>
          call(name, () => repo.readCommit(sha)).pipe(
            Effect.flatMap((found) =>
              found === null
                ? Effect.succeedNone
                : Effect.asSome(commitOf(found))
            )
          )
        ),
      readFile: (name, at, path) =>
        read(name, (repo) =>
          call(name, () => repo.readFile({ path, ref: refOf(at) })).pipe(
            Effect.flatMap((found) =>
              found === null
                ? Effect.succeedNone
                : Effect.asSome(bytesOf(found))
            )
          )
        ),
      readTree: (name, tree) => read(name, (repo) => treeAt(name, repo, tree)),
      refs: (name) => read(name, (repo) => refsOf(name, repo)),
      remote: (name) =>
        read(name, (repo) =>
          call(name, () => repo.info()).pipe(Effect.map(({ remote }) => remote))
        ),
      remove: (name) =>
        attempt(() => binding.delete(name)).pipe(
          Effect.catchTag("Thrown", asDefect)
        ),
      revokeToken: (name, id) =>
        read(name, (repo) => call(name, () => repo.revokeToken(id))),
      tags: (name) => read(name, (repo) => tagsOf(name, repo)),
    });
  });

export const RepoHostBinding = {
  layer: (binding: Artifacts): Layer.Layer<RepoHost, never, Fetch> =>
    Layer.effect(RepoHost, make(binding)),
};
