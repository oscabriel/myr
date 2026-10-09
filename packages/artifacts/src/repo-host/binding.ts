/**
 * `RepoHost` over the Workers `Artifacts` binding: how the deployed platform
 * keeps its repos. The binding's surprises, found by probing it live, come back
 * typed:
 *
 * - errors are read by `code`, and by message when there is none, as under
 *   `wrangler dev` remote bindings;
 * - a fork that answers 500 is tried once more, and an already-exists or a
 *   second 500 after that may be the fork the first made: it is, if it lists
 *   `main`;
 * - reads name a branch by its short name and a commit by its id, never
 *   `refs/…`, so `refs` and `push` go over git smart HTTP instead;
 * - a busy receive-pack is `HostBusy`.
 *
 * Refs and pushes use a token the adapter mints for the one call and revokes
 * after it; the token goes nowhere but the `Authorization` header of the
 * adapter's own requests. The day-long write token a create, a fork or an
 * import hands back is revoked at once: any write token can force-push
 * `main`, and no caller needs it. A repo still being
 * created or imported is asked for again, from 250 ms apart, up to eight
 * times. Every repo handle is disposed after use.
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

/**
 * The codes a message names when the error carries none: Artifacts'
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

/** A fork that answered `INTERNAL_ERROR`, which may still have made the repo. */
class MaybeForked extends Data.TaggedError("MaybeForked")<{
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

/** The codes `import` refuses a source with. */
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

/** Whether `get` found the repo still being created or imported. */
const stillMaking = (thrown: Thrown) =>
  threw("CREATE_IN_PROGRESS")(thrown) || threw("IMPORT_IN_PROGRESS")(thrown);

/** A handle to `name`, asked for again while the repo is still being made. */
const handleOf = (binding: Artifacts, name: RepoName) =>
  attempt(() => binding.get(name)).pipe(
    Effect.retry({
      schedule: Schedule.exponential(Duration.millis(250)),
      times: 7,
      while: stillMaking,
    }),
    Effect.catchTag("Thrown", (thrown) => fromArtifactsError(name, thrown))
  );

/** `use` over a handle to `name`, disposed after, whatever `use` came to. */
const withRepo = <A, E, R>(
  binding: Artifacts,
  name: RepoName,
  use: (repo: ArtifactsRepo) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.acquireRelease(handleOf(binding, name), (repo) =>
      Effect.sync(() => {
        repo[Symbol.dispose]();
      })
    ).pipe(Effect.flatMap(use))
  );

/**
 * The repo `made` names, its initial write token revoked: nothing the
 * adapter's callers do needs it. A revoke that fails is logged, never the
 * call's failure: the repo was made, and the token went nowhere.
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

/** The repo's tags over smart HTTP, peeled: the binding lists no refs. */
const tagsOf = (name: RepoName, repo: ArtifactsRepo) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { remote, token } = yield* access(name, repo, "read");

      return yield* listTags(remote, token);
    })
  );

/**
 * After a 500 and then an already-exists or a second 500, the fork may be
 * made: it is, if it lists `main`. Otherwise it is still being made, or
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
 * the target, and a 500 is `MaybeForked`, since it may have made the target.
 */
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

/**
 * Whether the repo holds `id` as a blob or a commit: `readBlob` answers
 * `null` for any other kind, and `readCommit` throws for a non-commit.
 */
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
    // A blob's or a commit's id names no tree, as on the other stores;
    // any other failure stays one.
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

/**
 * Artifacts through the Workers binding, the platform's `RepoHost` in
 * production. Refs and pushes go over git smart HTTP through `Fetch`.
 */
export const RepoHostBinding = {
  layer: (binding: Artifacts): Layer.Layer<RepoHost, never, Fetch> =>
    Layer.effect(RepoHost, make(binding)),
};
