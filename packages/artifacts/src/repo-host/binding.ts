/**
 * `RepoHost` over the Workers `Artifacts` binding: how the deployed platform
 * keeps its repos. The binding's surprises (S1, S2, S7) come back typed:
 *
 * - errors are read by `code`, and by message when there is none, as under
 *   `wrangler dev` remote bindings (S1 #22);
 * - a fork that answers 500 is tried once more, and an already-exists or a
 *   second 500 after that may be the fork the first made: it is, if it lists
 *   `main` (S7);
 * - reads name a branch by its short name and a commit by its id, never
 *   `refs/…` (S1 #20), so `refs` and `push` go over git smart HTTP instead;
 * - a busy receive-pack is `HostBusy` (S2 #9).
 *
 * Refs and pushes use a token the adapter mints for the one call and revokes
 * after it; the token goes nowhere but the `Authorization` header of the
 * adapter's own requests. Every repo handle is disposed after use.
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
  Revision,
  TreeEntry,
} from "../repo-host.ts";
import type { RepoName, RepoToken, TokenScope } from "../repo-host.ts";
import { listRefs, pushRefs } from "./smart-http.ts";

const Code = Schema.Literals([
  "ALREADY_EXISTS",
  "NOT_FOUND",
  "CREATE_IN_PROGRESS",
  "IMPORT_IN_PROGRESS",
  "FORK_IN_PROGRESS",
  "INVALID_INPUT",
  "INVALID_REPO_NAME",
  "INVALID_TTL",
  "INVALID_URL",
  "REMOTE_AUTH_REQUIRED",
  "UPSTREAM_UNAVAILABLE",
  "MEMORY_LIMIT",
  "INTERNAL_ERROR",
]);

type Code = typeof Code.Type;

const isCode = Schema.is(Code);

/**
 * The codes a message names when the error carries none (S1 #22): Artifacts'
 * words, the fake's, and the code itself.
 */
const MESSAGES = [
  [/not found/iu, "NOT_FOUND"],
  [/already exists/iu, "ALREADY_EXISTS"],
  [/fork[_ ]in[_ ]progress|still forking/iu, "FORK_IN_PROGRESS"],
  [/internal error/iu, "INTERNAL_ERROR"],
] as const satisfies readonly (readonly [RegExp, Code])[];

/**
 * What a call to the binding threw, read once: its `code`, or the one its
 * message names when it has none, and the error itself as the cause.
 */
class Thrown extends Data.TaggedError("Thrown")<{
  readonly code: Option.Option<Code>;
  readonly message: string;
  readonly error: unknown;
}> {}

/** An `INTERNAL_ERROR` from a fork, which may still have made the repo (S7 #2). */
class Internal extends Data.TaggedError("Internal")<{
  readonly thrown: Thrown;
}> {}

/** A promise of the binding's, failing with what it threw, read. */
const attempt = <A>(run: () => Promise<A>) =>
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
  });

const threw =
  (code: Code) =>
  (thrown: Thrown): boolean =>
    Option.contains(thrown.code, code);

/**
 * An error the binding threw, as the port's: by `code` first, by message
 * when there is none. Anything else is a defect, with the error as its cause.
 */
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

/** A call about the repo `name`, its errors read as the port's. */
const call = <A>(name: RepoName, run: () => Promise<A>) =>
  attempt(run).pipe(
    Effect.catchTag("Thrown", (thrown) => fromArtifactsError(name, thrown))
  );

const asDefect = ({ error }: Thrown) => Effect.die(error);

/** The port's reads and token calls fail only with `RepoNotFound`. */
const onlyNotFound = <A, R>(
  effect: Effect.Effect<A, RepoNotFound | RepoExists | ForkInProgress, R>
) =>
  effect.pipe(
    Effect.catchTags({ ForkInProgress: Effect.die, RepoExists: Effect.die })
  );

const main = RefName.make("refs/heads/main");

/** How long a token minted for one call lives; it is revoked after the call. */
const CALL_TOKEN_TTL = Duration.minutes(5);

// Artifacts takes a token's ttl in whole seconds, from a minute to a year.
const MIN_TTL_SECONDS = 60;

const MAX_TTL_SECONDS = 31_536_000;

const secondsOf = (ttl: Duration.Duration) =>
  Math.min(
    Math.max(Math.ceil(Duration.toSeconds(ttl)), MIN_TTL_SECONDS),
    MAX_TTL_SECONDS
  );

/** `log` reads at most this many commits per call. */
const LOG_PAGE = 1000;

/** The codes `import` refuses a source with: not git, not public, not reachable, too big. */
const IMPORT_REFUSALS: ReadonlySet<Code> = new Set([
  "INVALID_INPUT",
  "INVALID_URL",
  "MEMORY_LIMIT",
  "NOT_FOUND",
  "REMOTE_AUTH_REQUIRED",
  "UPSTREAM_UNAVAILABLE",
]);

/** The binding's name for a revision: never `refs/…` (S1 #20). */
const refOf = (at: Revision) =>
  Revision.$match(at, {
    Branch: ({ name }) => name,
    Commit: ({ sha }) => sha,
  });

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

/** `use` over a handle to `name`, disposed after, whatever `use` came to. */
const withRepo = <A, E, R>(
  binding: Artifacts,
  name: RepoName,
  use: (repo: ArtifactsRepo) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.acquireRelease(
      call(name, () => binding.get(name)),
      (repo) =>
        Effect.sync(() => {
          repo[Symbol.dispose]();
        })
    ).pipe(Effect.flatMap(use))
  );

/**
 * A token for one call, revoked when the scope closes, and the repo's
 * remote: what a smart-HTTP call to the repo needs.
 */
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

/**
 * After a 500 and then an already-exists or a second 500, the fork may be
 * made (S7): it is, if it lists `main`. Otherwise it is still being made, or
 * was undone; either way the caller tries again later.
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

/**
 * One fork call. The base's absence names the base; any other refusal names
 * the target, and a 500 is `Internal`, since it may have made the target.
 */
const forkOnce = (binding: Artifacts, base: RepoName, name: RepoName) =>
  withRepo(binding, base, (repo) =>
    attempt(() => repo.fork(name)).pipe(
      Effect.map(({ remote }) => ({ name, remote })),
      Effect.catchTag("Thrown", (thrown) =>
        Match.value(thrown).pipe(
          Match.when(threw("INTERNAL_ERROR"), () =>
            Effect.fail(new Internal({ thrown }))
          ),
          Match.when(threw("NOT_FOUND"), () =>
            Effect.fail(new RepoNotFound({ name: base }))
          ),
          Match.orElse(() => fromArtifactsError(name, thrown))
        )
      )
    )
  );

/** Artifacts throws `INTERNAL_ERROR` for an object that is no tree (workers-types). */
const treeAt = (name: RepoName, repo: ArtifactsRepo, tree: string) =>
  attempt(() => repo.readTree(tree)).pipe(
    Effect.flatMap((found) =>
      found === null ? Effect.succeedNone : Effect.asSome(entriesOf(found))
    ),
    // A blob's id names no tree, as on the other stores; any other failure
    // stays one.
    Effect.catchIf(threw("INTERNAL_ERROR"), ({ error }) =>
      call(name, () => repo.readBlob(tree)).pipe(
        Effect.flatMap((blob) =>
          blob === null ? Effect.die(error) : Effect.succeedNone
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
    Effect.map(({ remote }) => ({ name, remote })),
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
    )
  );

const log = (
  name: RepoName,
  repo: ArtifactsRepo,
  at: Revision,
  limit: number
) =>
  Effect.gen(function* () {
    const ref = refOf(at);
    const commits: Commit[] = [];

    while (commits.length < limit) {
      const asked = Math.min(limit - commits.length, LOG_PAGE);

      const page = yield* call(name, () =>
        repo.log({ limit: asked, offset: commits.length, ref })
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

    /** A read of `name`'s, failing only with `RepoNotFound`. */
    const read = <A>(
      name: RepoName,
      use: (
        repo: ArtifactsRepo
      ) => Effect.Effect<A, RepoNotFound | RepoExists | ForkInProgress, Fetch>
    ) =>
      onlyNotFound(withRepo(binding, name, use)).pipe(
        Effect.provideService(Fetch, fetch)
      );

    return RepoHost.of({
      create: (name) =>
        call(name, () => binding.create(name)).pipe(
          Effect.map(({ remote }) => ({ name, remote })),
          Effect.catchTags({
            ForkInProgress: Effect.die,
            RepoNotFound: Effect.die,
          })
        ),
      // S7: a 500 is tried once more; an already-exists or a second 500 after
      // it may be the fork the first made, so it is confirmed, not trusted.
      fork: (base, name) =>
        forkOnce(binding, base, name).pipe(
          Effect.catchTag("Internal", () =>
            forkOnce(binding, base, name).pipe(
              Effect.catchTags({
                Internal: () => confirmed(binding, name),
                RepoExists: () => confirmed(binding, name),
              })
            )
          ),
          Effect.provideService(Fetch, fetch)
        ),
      importFrom: (name, source) => importFrom(binding, name, source),
      log: (name, at, limit) =>
        read(name, (repo) => log(name, repo, at, limit)),
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
    });
  });

/**
 * Artifacts through the Workers binding, the platform's `RepoHost` in
 * production. Refs and pushes go over git smart HTTP through `Fetch`.
 */
export const RepoHostBinding = {
  layer: (binding: Artifacts): Layer.Layer<RepoHost, never, Fetch> =>
    Layer.effect(RepoHost, make(binding)),
};
