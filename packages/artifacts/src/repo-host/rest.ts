/**
 * Over the REST API, as probes and the docs found it:
 *
 * - a fork names its target (`{name, default_branch_only: true}`), which
 *   cf's `artifacts namespaces repos fork` cannot do;
 * - a fork that answers 500 (code 10400) may still have made the repo, as on
 *   the binding;
 * - `refs` and `push` have no REST route, so they go over git smart HTTP;
 * - a token id resolves through an eventually consistent index, so revoking
 *   it within about a second of its mint can be 404.
 *
 * ASSUMPTIONs, for a live run to settle: a commit's fields are snake case or
 * camel case; a 404 from a read is the object's absence once the repo exists;
 * a tree read at another kind of object is 500; and a log page may hold fewer
 * commits than asked, so only an empty page ends it.
 */
import { CommitSha } from "@repo/protocol/ids";
import {
  Data,
  DateTime,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Redacted,
  Ref,
  Schema,
} from "effect";

import { Fetch } from "../fetch.ts";
import {
  ForkInProgress,
  ImportRefused,
  ObjectId,
  RefName,
  RepoExists,
  RepoHost,
  RepoNotFound,
  TreeEntry,
} from "../repo-host.ts";
import type {
  Commit,
  RepoName,
  RepoToken,
  TokenScope,
  Revision,
} from "../repo-host.ts";
import {
  LOG_PAGE,
  NO_SOURCE,
  NUMBERED,
  refOf,
  secondsOf,
} from "./artifacts-api.ts";
import type { Code } from "./artifacts-api.ts";
import { listRefs, listTags, pushRefs } from "./smart-http.ts";

const byStatus = (status: number): Option.Option<Code> =>
  Match.value(status).pipe(
    Match.when(404, () => Option.some<Code>("NOT_FOUND")),
    Match.when(
      (code) => code >= 500,
      () => Option.some<Code>("INTERNAL_ERROR")
    ),
    Match.orElse(() => Option.none())
  );

class Refused extends Data.TaggedError("Refused")<{
  readonly status: number;
  readonly code: Option.Option<Code>;
  readonly message: string;
}> {}

class MaybeForked extends Data.TaggedError("MaybeForked")<{
  readonly refused: Refused;
}> {}

const Problem = Schema.Struct({ code: Schema.Int, message: Schema.String });

const Failure = Schema.fromJsonString(
  Schema.Struct({ errors: Schema.Array(Problem) })
);

const decodeFailure = Schema.decodeOption(Failure);

/**
 * A reply naming only codes Artifacts does not own (Cloudflare's 7000 for an
 * unknown route) reads as no code, so a wrong route, account or namespace is
 * a defect and never passes for a missing repo or object.
 */
const refusedBy = (status: number, text: string) => {
  const problems = Option.match(decodeFailure(text), {
    onNone: () => [],
    onSome: ({ errors }) => errors,
  });

  return new Refused({
    code:
      problems.length === 0
        ? byStatus(status)
        : Option.firstSomeOf(
            problems.map(({ code }) => Option.fromNullishOr(NUMBERED.get(code)))
          ),
    message:
      problems.map(({ message }) => message).join("; ") || `HTTP ${status}`,
    status,
  });
};

const is =
  (...codes: readonly Code[]) =>
  (refused: Refused): boolean =>
    Option.exists(refused.code, (code) => codes.includes(code));

const Envelope = <S extends Schema.Top>(result: S) =>
  Schema.fromJsonString(
    Schema.Struct({ result, success: Schema.Literal(true) })
  );

const Remote = Envelope(Schema.Struct({ remote: Schema.String }));

const Minted = Envelope(
  Schema.Struct({
    expires_at: Schema.String,
    id: Schema.String,
    plaintext: Schema.String,
  })
);

const Person = Schema.Struct({ email: Schema.String, name: Schema.String });

const commitFields = {
  author: Person,
  committer: Person,
  hash: CommitSha,
  message: Schema.String,
  parents: Schema.Array(CommitSha),
};

// ASSUMPTION: the REST API spells the binding's times as it spells
// `tree_hash`, in snake case, or as the binding does.
const Metadata = Schema.Union([
  Schema.Struct({
    ...commitFields,
    authored_at: Schema.Int,
    committed_at: Schema.Int,
    tree_hash: ObjectId,
  }),
  Schema.Struct({
    ...commitFields,
    authoredAt: Schema.Int,
    committedAt: Schema.Int,
    treeHash: ObjectId,
  }),
]);

type Metadata = typeof Metadata.Type;

const CommitReply = Envelope(Metadata);

const LogReply = Envelope(Schema.Array(Metadata));

const TreeReply = Envelope(
  Schema.Array(
    Schema.Struct({ hash: ObjectId, mode: Schema.String, name: Schema.String })
  )
);

const decodeEntries = Schema.decodeUnknownEffect(Schema.Array(TreeEntry));

const commitOf = (metadata: Metadata): Commit => ({
  author: metadata.author,
  ...("tree_hash" in metadata
    ? {
        authoredAt: metadata.authored_at,
        committedAt: metadata.committed_at,
        tree: metadata.tree_hash,
      }
    : {
        authoredAt: metadata.authoredAt,
        committedAt: metadata.committedAt,
        tree: metadata.treeHash,
      }),
  committer: metadata.committer,
  message: metadata.message,
  parents: metadata.parents,
  sha: metadata.hash,
});

// Artifacts gives canonical modes: a folder is `40000`, as git stores it, not
// `040000`, as `ls-tree` prints it and the port has it.
const entriesOf = (entries: typeof TreeReply.Type.result) =>
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

const repoPath = (name: RepoName) => `/repos/${encodeURIComponent(name)}`;

const textOf = (response: Response) => Effect.promise(() => response.text());

const refusal = (response: Response) =>
  textOf(response).pipe(
    Effect.flatMap((text) => Effect.fail(refusedBy(response.status, text)))
  );

const decoded =
  <A>(codec: Schema.Codec<A, string>) =>
  (response: Response) =>
    response.ok
      ? textOf(response).pipe(
          Effect.flatMap(Schema.decodeEffect(codec)),
          Effect.orDie
        )
      : refusal(response);

const bytesOf = (response: Response) =>
  response.ok
    ? Effect.promise(() => response.arrayBuffer()).pipe(
        Effect.map((buffer) => new Uint8Array(buffer))
      )
    : refusal(response);

const accepted = (response: Response) =>
  response.ok ? Effect.void : refusal(response);

const main = RefName.make("refs/heads/main");

const CALL_TOKEN_TTL = Duration.minutes(30);

const CALL_TOKEN_MARGIN = Duration.minutes(5);

const REVOKE_LAG = Duration.seconds(2);

interface Token {
  readonly name: RepoName;
  readonly at: DateTime.Utc;
  readonly forCalls: boolean;
}

interface Access {
  readonly name: RepoName;
  readonly remote: string;
  readonly token: Redacted.Redacted;
  readonly expiresAt: DateTime.Utc;
}

const keeping = <K, V>(
  map: ReadonlyMap<K, V>,
  keep: (value: V, key: K) => boolean
): ReadonlyMap<K, V> =>
  new Map([...map].filter(([key, value]) => keep(value, key)));

/** A repo that exists but is still being made answers its info and mints 409. */
const BEING_MADE = [
  "CREATE_IN_PROGRESS",
  "FORK_IN_PROGRESS",
  "IMPORT_IN_PROGRESS",
] as const satisfies readonly Code[];

const TAKEN = [
  "ALREADY_EXISTS",
  ...BEING_MADE,
] as const satisfies readonly Code[];

const make = (options: {
  readonly accountId: string;
  readonly namespace: string;
  readonly token: Redacted.Redacted;
  readonly base?: string;
}) =>
  Effect.gen(function* () {
    // The service alone: the layer's whole context would carry its Scope, and
    // every call's finalizers would wait for the layer's end.
    const fetch = yield* Fetch;

    const root = [
      (options.base ?? "https://api.cloudflare.com/client/v4").replace(
        /\/+$/u,
        ""
      ),
      "accounts",
      encodeURIComponent(options.accountId),
      "artifacts/namespaces",
      encodeURIComponent(options.namespace),
    ].join("/");

    const minted = yield* Ref.make<ReadonlyMap<string, Token>>(new Map());
    const access = yield* Ref.make<ReadonlyMap<string, Access>>(new Map());

    const authorization = () => `Bearer ${Redacted.value(options.token)}`;

    const send = (request: Request) => fetch.fetch(request).pipe(Effect.orDie);

    const httpGet = (path: string) =>
      send(
        new Request(`${root}${path}`, {
          headers: { accept: "*/*", authorization: authorization() },
          method: "GET",
        })
      );

    const httpDelete = (path: string) =>
      send(
        new Request(`${root}${path}`, {
          headers: {
            accept: "application/json",
            authorization: authorization(),
          },
          method: "DELETE",
        })
      );

    const httpPost = (
      path: string,
      body:
        | { readonly name: RepoName }
        | { readonly default_branch_only: true; readonly name: RepoName }
        | { readonly branch?: string; readonly url: string }
        | {
            readonly repo: RepoName;
            readonly scope: TokenScope;
            readonly ttl: number;
          }
    ) =>
      send(
        new Request(`${root}${path}`, {
          body: JSON.stringify(body),
          headers: {
            accept: "application/json",
            authorization: authorization(),
            "content-type": "application/json",
          },
          method: "POST",
        })
      );

    const infoOf = (name: RepoName) =>
      httpGet(repoPath(name)).pipe(
        Effect.flatMap(decoded(Remote)),
        Effect.map(({ result }) => result.remote),
        Effect.catchTag("Refused", (refused) =>
          Match.value(refused).pipe(
            Match.when(is("NOT_FOUND"), () =>
              Effect.fail(new RepoNotFound({ name }))
            ),
            Match.when(is(...BEING_MADE), () =>
              Effect.fail(new ForkInProgress({ name }))
            ),
            Match.orElse(Effect.die)
          )
        )
      );

    const remoteOf = (name: RepoName) =>
      infoOf(name).pipe(Effect.catchTag("ForkInProgress", Effect.die));

    const optional = <A>(name: RepoName, read: Effect.Effect<A, Refused>) =>
      read.pipe(
        Effect.asSome,
        Effect.catchTag("Refused", (refused) =>
          is("NOT_FOUND")(refused)
            ? remoteOf(name).pipe(Effect.as(Option.none<A>()))
            : Effect.die(refused)
        )
      );

    const mint = (
      name: RepoName,
      scope: TokenScope,
      seconds: number,
      forCalls: boolean
    ) =>
      Effect.gen(function* () {
        const at = yield* DateTime.now;

        const { result } = yield* httpPost("/tokens", {
          repo: name,
          scope,
          ttl: seconds,
        }).pipe(
          Effect.flatMap(decoded(Minted)),
          Effect.catchTag("Refused", (refused) =>
            Match.value(refused).pipe(
              Match.when(is("NOT_FOUND"), () =>
                Effect.fail(new RepoNotFound({ name }))
              ),
              Match.when(is(...BEING_MADE), () =>
                Effect.fail(new ForkInProgress({ name }))
              ),
              Match.orElse(Effect.die)
            )
          )
        );

        yield* Ref.update(minted, (all) =>
          new Map(all).set(result.id, { at, forCalls, name })
        );

        // Never later than either clock says: the ttl asked for, from before
        // the request, or the store's own expiry.
        const asked = DateTime.add(at, { seconds });

        const expiresAt = Option.match(DateTime.make(result.expires_at), {
          onNone: () => asked,
          onSome: (stated) => DateTime.min(asked, stated),
        });

        return {
          expiresAt,
          id: result.id,
          scope,
          secret: Redacted.make(result.plaintext),
        } satisfies RepoToken;
      });

    const revokeOnce = (id: string) =>
      httpDelete(`/tokens/${encodeURIComponent(id)}`).pipe(
        Effect.flatMap(accepted),
        Effect.as(true),
        Effect.catchTag("Refused", (refused) =>
          is("NOT_FOUND")(refused) ? Effect.succeed(false) : Effect.die(refused)
        )
      );

    const revoke = (id: string) =>
      Effect.gen(function* () {
        const token = (yield* Ref.get(minted)).get(id);
        const revoked = yield* revokeOnce(id);
        const now = yield* DateTime.now;

        const known = Option.filter(
          Option.map(Option.fromNullishOr(token), ({ at }) =>
            DateTime.addDuration(at, REVOKE_LAG)
          ),
          (settled) => DateTime.isLessThan(now, settled)
        );

        const again =
          revoked || Option.isNone(known)
            ? revoked
            : yield* Effect.sleep(DateTime.distance(now, known.value)).pipe(
                Effect.andThen(revokeOnce(id))
              );

        yield* Ref.update(minted, (all) =>
          keeping(all, (_, key) => key !== id)
        );

        return again;
      });

    const accessOf = (name: RepoName, scope: TokenScope) =>
      Effect.gen(function* () {
        const key = `${scope}:${name}`;
        const now = yield* DateTime.now;
        const kept = (yield* Ref.get(access)).get(key);

        if (
          kept !== undefined &&
          DateTime.isLessThan(
            DateTime.addDuration(now, CALL_TOKEN_MARGIN),
            kept.expiresAt
          )
        ) {
          return kept;
        }

        const remote = yield* infoOf(name);
        const token = yield* mint(name, scope, secondsOf(CALL_TOKEN_TTL), true);

        const fresh: Access = {
          expiresAt: token.expiresAt,
          name,
          remote,
          token: token.secret,
        };

        yield* Ref.update(access, (all) => new Map(all).set(key, fresh));

        return fresh;
      });

    /** A removed repo's tokens are gone with it (workers-types). */
    const forget = (name: RepoName) =>
      Effect.all([
        Ref.update(minted, (all) =>
          keeping(all, (token) => token.name !== name)
        ),
        Ref.update(access, (all) => keeping(all, (kept) => kept.name !== name)),
      ]);

    yield* Effect.addFinalizer(() =>
      Ref.get(minted).pipe(
        Effect.flatMap((all) =>
          Effect.forEach(
            [...all].filter(([, token]) => token.forCalls),
            ([id]) => Effect.exit(revoke(id)),
            { concurrency: "unbounded", discard: true }
          )
        )
      )
    );

    /**
     * After a 500 and then an already-exists or a second 500, the fork may be
     * made: it is, if it lists `main`.
     */
    const confirmed = (name: RepoName) =>
      Effect.gen(function* () {
        const { remote, token } = yield* accessOf(name, "read");
        const refs = yield* listRefs(remote, token);

        if (!refs.has(main)) {
          return yield* new ForkInProgress({ name });
        }

        return { name, remote };
      }).pipe(
        Effect.catchTag("RepoNotFound", () =>
          Effect.fail(new ForkInProgress({ name }))
        ),
        Effect.provideService(Fetch, fetch)
      );

    const forkOnce = (from: RepoName, name: RepoName) =>
      httpPost(`${repoPath(from)}/fork`, {
        default_branch_only: true,
        name,
      }).pipe(
        Effect.flatMap(decoded(Remote)),
        Effect.map(({ result }) => ({ name, remote: result.remote })),
        Effect.catchTag("Refused", (refused) =>
          Match.value(refused).pipe(
            Match.when(is("INTERNAL_ERROR"), () =>
              Effect.fail(new MaybeForked({ refused }))
            ),
            Match.when(is("NOT_FOUND"), () =>
              Effect.fail(new RepoNotFound({ name: from }))
            ),
            Match.when(is("ALREADY_EXISTS"), () =>
              Effect.fail(new RepoExists({ name }))
            ),
            Match.when(is("FORK_IN_PROGRESS"), () =>
              Effect.fail(new ForkInProgress({ name }))
            ),
            Match.orElse(Effect.die)
          )
        )
      );

    const blobOrCommit = (name: RepoName, id: ObjectId) =>
      optional(
        name,
        httpGet(`${repoPath(name)}/blob/${id}`).pipe(Effect.flatMap(bytesOf))
      ).pipe(
        Effect.flatMap((blob) =>
          Option.isSome(blob)
            ? Effect.succeed(true)
            : httpGet(`${repoPath(name)}/commit/${id}`).pipe(
                Effect.flatMap(accepted),
                Effect.as(true),
                Effect.catchTag("Refused", (refused) =>
                  is("NOT_FOUND", "INTERNAL_ERROR")(refused)
                    ? Effect.succeed(false)
                    : Effect.die(refused)
                )
              )
        )
      );

    const treeOrBlob = (name: RepoName, id: ObjectId) =>
      optional(
        name,
        httpGet(`${repoPath(name)}/blob/${id}`).pipe(Effect.flatMap(bytesOf))
      ).pipe(
        Effect.flatMap((blob) =>
          Option.isSome(blob)
            ? Effect.succeed(true)
            : httpGet(`${repoPath(name)}/tree/${id}`).pipe(
                Effect.flatMap(accepted),
                Effect.as(true),
                Effect.catchTag("Refused", (refused) =>
                  is("NOT_FOUND", "INTERNAL_ERROR")(refused)
                    ? Effect.succeed(false)
                    : Effect.die(refused)
                )
              )
        )
      );

    // Artifacts answers 500 for an object that is no commit, as a full SHA a
    // reader hands in (a raw URL, a code read's `at`) may name a tree or a blob.
    const readCommit = (name: RepoName, sha: CommitSha) =>
      httpGet(`${repoPath(name)}/commit/${sha}`).pipe(
        Effect.flatMap(decoded(CommitReply)),
        Effect.map(({ result }) => Option.some(commitOf(result))),
        Effect.catchTag("Refused", (refused) =>
          Match.value(refused).pipe(
            Match.when(is("NOT_FOUND"), () =>
              remoteOf(name).pipe(Effect.as(Option.none<Commit>()))
            ),
            Match.when(is("INTERNAL_ERROR"), () =>
              treeOrBlob(name, ObjectId.make(sha)).pipe(
                Effect.flatMap((other) =>
                  other ? Effect.succeedNone : Effect.die(refused)
                )
              )
            ),
            Match.orElse(Effect.die)
          )
        )
      );

    const readTree = (name: RepoName, tree: ObjectId) =>
      httpGet(`${repoPath(name)}/tree/${tree}`).pipe(
        Effect.flatMap(decoded(TreeReply)),
        Effect.flatMap(({ result }) => entriesOf(result)),
        Effect.asSome,
        Effect.catchTag("Refused", (refused) =>
          Match.value(refused).pipe(
            Match.when(is("NOT_FOUND"), () =>
              remoteOf(name).pipe(Effect.as(Option.none()))
            ),
            Match.when(is("INTERNAL_ERROR"), () =>
              blobOrCommit(name, tree).pipe(
                Effect.flatMap((other) =>
                  other ? Effect.succeedNone : Effect.die(refused)
                )
              )
            ),
            Match.orElse(Effect.die)
          )
        )
      );

    const page = (name: RepoName, ref: string, offset: number, limit: number) =>
      httpGet(
        `${repoPath(name)}/log?${new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
          ref,
        }).toString()}`
      ).pipe(
        Effect.flatMap(decoded(LogReply)),
        Effect.map(({ result }) => result.map(commitOf)),
        Effect.catchTag("Refused", (refused) =>
          is("NOT_FOUND")(refused)
            ? remoteOf(name).pipe(Effect.as([]))
            : Effect.die(refused)
        )
      );

    const log = (name: RepoName, at: Revision, limit: number, offset = 0) =>
      Effect.gen(function* () {
        const commits: Commit[] = [];

        while (commits.length < limit) {
          const more = yield* page(
            name,
            refOf(at),
            offset + commits.length,
            Math.min(limit - commits.length, LOG_PAGE)
          );

          if (more.length === 0) {
            break;
          }

          commits.push(...more);
        }

        return commits.slice(0, limit);
      });

    return RepoHost.of({
      // A repo of that name still being made is a name already taken.
      create: (name) =>
        httpPost("/repos", { name }).pipe(
          Effect.flatMap(decoded(Remote)),
          Effect.map(({ result }) => ({ name, remote: result.remote })),
          Effect.catchTag("Refused", (refused) =>
            is(...TAKEN)(refused)
              ? Effect.fail(new RepoExists({ name }))
              : Effect.die(refused)
          )
        ),
      // A 500 is tried once more; an already-exists or a second 500 after
      // it may be the fork the first made, so it is confirmed, not trusted.
      fork: (base, name) =>
        forkOnce(base, name).pipe(
          Effect.catchTag("MaybeForked", () =>
            forkOnce(base, name).pipe(
              Effect.catchTags({
                MaybeForked: () => confirmed(name),
                RepoExists: () => confirmed(name),
              })
            )
          )
        ),
      importFrom: (name, source) =>
        httpPost(
          `${repoPath(name)}/import`,
          source.branch === undefined
            ? { url: source.url }
            : { branch: source.branch, url: source.url }
        ).pipe(
          Effect.flatMap(decoded(Remote)),
          Effect.map(({ result }) => ({ name, remote: result.remote })),
          Effect.catchTag("Refused", (refused) =>
            Match.value(refused).pipe(
              Match.when(is(...TAKEN), () =>
                Effect.fail(new RepoExists({ name }))
              ),
              Match.when(is(...NO_SOURCE), ({ message }) =>
                Effect.fail(new ImportRefused({ name, reason: message }))
              ),
              Match.orElse(Effect.die)
            )
          )
        ),
      log,
      mintToken: (name, scope, ttl) =>
        mint(name, scope, secondsOf(ttl), false).pipe(
          Effect.catchTag("ForkInProgress", Effect.die)
        ),
      push: (name, source, updates) =>
        accessOf(name, "write").pipe(
          Effect.flatMap(({ remote, token }) =>
            pushRefs({ remote, source, token, updates })
          ),
          Effect.catchTag("ForkInProgress", Effect.die),
          Effect.provideService(Fetch, fetch)
        ),
      readBlob: (name, blob) =>
        optional(
          name,
          httpGet(`${repoPath(name)}/blob/${blob}`).pipe(
            Effect.flatMap(bytesOf)
          )
        ),
      readCommit,
      readFile: (name, at, path) =>
        optional(
          name,
          httpGet(
            `${repoPath(name)}/file?${new URLSearchParams({
              path,
              ref: refOf(at),
            }).toString()}`
          ).pipe(Effect.flatMap(bytesOf))
        ),
      readTree,
      refs: (name) =>
        accessOf(name, "read").pipe(
          Effect.flatMap(({ remote, token }) => listRefs(remote, token)),
          Effect.catchTag("ForkInProgress", Effect.die),
          Effect.provideService(Fetch, fetch)
        ),
      remote: remoteOf,
      remove: (name) =>
        httpDelete(repoPath(name)).pipe(
          Effect.flatMap(accepted),
          Effect.as(true),
          Effect.catchTag("Refused", (refused) =>
            is("NOT_FOUND")(refused)
              ? Effect.succeed(false)
              : Effect.die(refused)
          ),
          Effect.tap(() => forget(name))
        ),
      // The route takes the id alone; the repo is checked to exist, as the
      // binding's `get` does.
      revokeToken: (name, id) =>
        remoteOf(name).pipe(Effect.andThen(revoke(id))),
      tags: (name) =>
        accessOf(name, "read").pipe(
          Effect.flatMap(({ remote, token }) => listTags(remote, token)),
          Effect.catchTag("ForkInProgress", Effect.die),
          Effect.provideService(Fetch, fetch)
        ),
    });
  });

export const RepoHostRest = {
  layer: (options: {
    readonly accountId: string;
    readonly namespace: string;
    readonly token: Redacted.Redacted;
    readonly base?: string;
  }): Layer.Layer<RepoHost, never, Fetch> =>
    Layer.effect(RepoHost, make(options)),
};
