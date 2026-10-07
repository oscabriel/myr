/**
 * `RepoHost` over the Artifacts REST API, with a Cloudflare API token: for
 * code that runs outside a Worker, such as infra scripts, the bench and the
 * seed script. It passes the contract the binding passes, and types the same
 * surprises (S1, S7):
 *
 * - a fork names its target (`{name, default_branch_only: true}`), which
 *   cf's `artifacts namespaces repos fork` cannot do (cf #180);
 * - a fork that answers 500 (code 10400) is tried once more, and an
 *   already-exists or a second 500 after that may be the fork the first
 *   made: it is, if it lists `main` (S7), as on the binding;
 * - `refs` and `push` have no REST route, so they go over git smart HTTP to
 *   the repo's `remote` (`smart-http.ts`), with a repo token this layer mints.
 *
 * Every route is under `<base>/accounts/<accountId>/artifacts/namespaces/
 * <namespace>` and carries the API token as `Authorization: Bearer`, and
 * nowhere else. Each was confirmed with `bun run ops -- schema artifacts
 * namespaces <command>` (cf 1.0.0-beta.12, read-only), and against
 * Artifacts' REST docs (developers.cloudflare.com/artifacts/api/rest-api),
 * which spell bodies in snake case where cf's flags use kebab case:
 *
 * | Port | Route | `<command>` | Body or query |
 * | --- | --- | --- | --- |
 * | `create` | `POST /repos` | `repos create` | `{name}` |
 * | `remote`, and whether a repo exists | `GET /repos/{name}` | `repos get` | |
 * | `remove` | `DELETE /repos/{name}` | `repos delete` | |
 * | `fork` | `POST /repos/{base}/fork` | `repos fork` | `{name, default_branch_only: true}`: the docs and the probes (S1 #9, S7) send `name`; cf's schema lacks it (cf #180) |
 * | `importFrom` | `POST /repos/{name}/import` | `repos import` | `{url, branch?}` |
 * | `mintToken`, and the git calls' tokens | `POST /tokens` | `tokens create` | `{repo, scope, ttl}` |
 * | `revokeToken` | `DELETE /tokens/{id}` | `tokens revoke` | |
 * | `readCommit` | `GET /repos/{name}/commit/{hash}` | `repos commits get` | |
 * | `readTree` | `GET /repos/{name}/tree/{hash}` | `repos trees get` | |
 * | `readBlob` | `GET /repos/{name}/blob/{hash}` | `repos blobs get` | raw bytes back |
 * | `readFile` | `GET /repos/{name}/file` | `repos files get` | `?ref&path`; raw bytes back |
 * | `log` | `GET /repos/{name}/log` | `repos logs get` | `?ref&limit&offset` |
 *
 * cf's schema gives no reply shapes. From the docs: every JSON reply, and
 * every refusal, is Cloudflare's v4 envelope, `{success, errors: [{code,
 * message}], messages, result}`; blob and file replies are raw bytes; create,
 * fork, import and a repo's info carry `remote`; a minted token is `{id,
 * plaintext, scope, expires_at}`; a repo still being imported or forked
 * answers 409 (cf's generated client declares 409 for a repo's info and a
 * token's mint too); errors carry Artifacts' numeric codes (its errors
 * page), which the binding's `numericCode` matches (workers-types), and S7
 * saw 10201 and 10400 live. A refusal with no code Artifacts names, such as
 * a proxy's, is read by its status: 404 is not found, 5xx internal.
 * ASSUMPTIONs, for a live run (W3 308, W7's bench) to settle:
 *
 * - a commit is the binding's metadata, spelled in snake case
 *   (`tree_hash`) as the API's other fields are, or in camel case as the
 *   binding's; a tree's `result` is the binding's entries, and a log's is a
 *   list of commit metadata;
 * - a 404 from a read is the object's absence once the repo is found to
 *   exist, and a tree read at another kind of object fails as the binding's
 *   does (500), so the adapter asks whether it is a blob or a commit;
 * - a log page may hold fewer commits than asked before the history ends
 *   (a server cap), so only an empty page ends it.
 *
 * A token id resolves through an eventually consistent index, so revoking it
 * within about a second of its mint can be 404 (cf's help for `tokens
 * revoke`): a 404 for a token this layer minted less than two seconds ago is
 * tried once more when they have passed. Git calls share one token per repo
 * and scope, minted on first use, minted again near its expiry, and revoked
 * when the layer closes. The day-long write token create, fork and import
 * return (S1 #2) is dropped, as the binding drops it.
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
  Revision,
  TreeEntry,
} from "../repo-host.ts";
import type { Commit, RepoName, RepoToken, TokenScope } from "../repo-host.ts";
import { listRefs, pushRefs } from "./smart-http.ts";

/** The binding's names for Artifacts' errors (`ArtifactsError.code`). */
type Code =
  | "ALREADY_EXISTS"
  | "NOT_FOUND"
  | "CREATE_IN_PROGRESS"
  | "IMPORT_IN_PROGRESS"
  | "FORK_IN_PROGRESS"
  | "INVALID_INPUT"
  | "INVALID_REPO_NAME"
  | "INVALID_TTL"
  | "INVALID_URL"
  | "REMOTE_AUTH_REQUIRED"
  | "UPSTREAM_UNAVAILABLE"
  | "MEMORY_LIMIT"
  | "INTERNAL_ERROR";

/**
 * Each REST `errors[].code` by the binding's name for it, from Artifacts'
 * errors page. The page gives `CREATE_IN_PROGRESS` no number.
 */
const NUMBERED = new Map<number, Code>([
  [10_100, "INVALID_INPUT"],
  [10_101, "INVALID_REPO_NAME"],
  [10_103, "INVALID_TTL"],
  [10_104, "INVALID_URL"],
  [10_106, "REMOTE_AUTH_REQUIRED"],
  [10_200, "NOT_FOUND"],
  [10_201, "ALREADY_EXISTS"],
  [10_302, "IMPORT_IN_PROGRESS"],
  [10_303, "FORK_IN_PROGRESS"],
  [10_400, "INTERNAL_ERROR"],
  [10_401, "UPSTREAM_UNAVAILABLE"],
  [10_402, "MEMORY_LIMIT"],
]);

/** A refusal with no code Artifacts names, such as a proxy's, read by status. */
const byStatus = (status: number): Option.Option<Code> =>
  Match.value(status).pipe(
    Match.when(404, () => Option.some<Code>("NOT_FOUND")),
    Match.when(
      (code) => code >= 500,
      () => Option.some<Code>("INTERNAL_ERROR")
    ),
    Match.orElse(() => Option.none())
  );

/** A reply that was no success: its status, the code it names, its messages. */
class Refused extends Data.TaggedError("Refused")<{
  readonly status: number;
  readonly code: Option.Option<Code>;
  readonly message: string;
}> {}

/** A fork that answered 500, which may still have made the repo (S7 #2). */
class MaybeForked extends Data.TaggedError("MaybeForked")<{
  readonly refused: Refused;
}> {}

const Problem = Schema.Struct({ code: Schema.Int, message: Schema.String });

const Failure = Schema.fromJsonString(
  Schema.Struct({ errors: Schema.Array(Problem) })
);

const decodeFailure = Schema.decodeOption(Failure);

/** A refused reply read: by the first code Artifacts names, then its status. */
const refusedBy = (status: number, text: string) => {
  const problems = Option.match(decodeFailure(text), {
    onNone: () => [],
    onSome: ({ errors }) => errors,
  });

  return new Refused({
    code: Option.orElse(
      Option.firstSomeOf(
        problems.map(({ code }) => Option.fromNullishOr(NUMBERED.get(code)))
      ),
      () => byStatus(status)
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

/** Cloudflare's v4 envelope around a success's `result`. */
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

const Metadata = Schema.Union([
  Schema.Struct({ ...commitFields, tree_hash: ObjectId }),
  Schema.Struct({ ...commitFields, treeHash: ObjectId }),
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
  committer: metadata.committer,
  message: metadata.message,
  parents: metadata.parents,
  sha: metadata.hash,
  tree: "tree_hash" in metadata ? metadata.tree_hash : metadata.treeHash,
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

/** The API's name for a revision: a short branch name or a commit id (S1 #20). */
const refOf = (at: Revision) =>
  Revision.$match(at, {
    Branch: ({ name }) => name,
    Commit: ({ sha }) => sha,
  });

const repoPath = (name: RepoName) => `/repos/${encodeURIComponent(name)}`;

const textOf = (response: Response) => Effect.promise(() => response.text());

const refusal = (response: Response) =>
  textOf(response).pipe(
    Effect.flatMap((text) => Effect.fail(refusedBy(response.status, text)))
  );

/** A success's envelope, decoded at the boundary, or what refused it. */
const decoded =
  <A>(codec: Schema.Codec<A, string>) =>
  (response: Response) =>
    response.ok
      ? textOf(response).pipe(
          Effect.flatMap(Schema.decodeEffect(codec)),
          Effect.orDie
        )
      : refusal(response);

/** A success's raw bytes, or what refused it. */
const bytesOf = (response: Response) =>
  response.ok
    ? Effect.promise(() => response.arrayBuffer()).pipe(
        Effect.map((buffer) => new Uint8Array(buffer))
      )
    : refusal(response);

const accepted = (response: Response) =>
  response.ok ? Effect.void : refusal(response);

const main = RefName.make("refs/heads/main");

/** `log` asks for at most this many commits per request, as the binding does. */
const LOG_PAGE = 1000;

// Artifacts takes a token's ttl in whole seconds, from a minute to a year.
const MIN_TTL_SECONDS = 60;

const MAX_TTL_SECONDS = 31_536_000;

const secondsOf = (ttl: Duration.Duration) =>
  Math.min(
    Math.max(Math.ceil(Duration.toSeconds(ttl)), MIN_TTL_SECONDS),
    MAX_TTL_SECONDS
  );

/** How long a token for git calls lives, and how near its expiry it is replaced. */
const CALL_TOKEN_TTL = Duration.minutes(30);

const CALL_TOKEN_MARGIN = Duration.minutes(5);

/** How long a token id may be unknown to the index after its mint. */
const REVOKE_LAG = Duration.seconds(2);

/** A token this layer minted and has not revoked. */
interface Token {
  readonly name: RepoName;
  readonly at: DateTime.Utc;
  /** Minted for the layer's own git calls, and revoked when it closes. */
  readonly forCalls: boolean;
}

/** What a git call to a repo needs: its remote, and a token. */
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

/** The import refusals that say the source is no repo to take (the binding's). */
const NO_SOURCE = [
  "INVALID_INPUT",
  "INVALID_URL",
  "MEMORY_LIMIT",
  "NOT_FOUND",
  "REMOTE_AUTH_REQUIRED",
  "UPSTREAM_UNAVAILABLE",
] as const satisfies readonly Code[];

/** A repo that exists but is still being made answers its info and mints 409. */
const BEING_MADE = [
  "CREATE_IN_PROGRESS",
  "FORK_IN_PROGRESS",
  "IMPORT_IN_PROGRESS",
] as const satisfies readonly Code[];

const make = (options: {
  readonly accountId: string;
  readonly namespace: string;
  readonly token: Redacted.Redacted;
  readonly base?: string;
}) =>
  Effect.gen(function* () {
    // The service alone: the layer's whole context would carry its Scope, and
    // every call's finalizers would wait for the layer's end (217).
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

    /** One request to the API; one that got no response is a defect. */
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

    /** A repo's remote; a 409 there is a repo still being made. */
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

    /**
     * A read whose 404 is the object's absence once the repo is found to
     * exist; any other refusal is a defect.
     */
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

    /**
     * Revokes the token `id`, once more when the index may not know it yet;
     * whether it was revoked. The layer forgets the token either way.
     */
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

    /** The remote and token a git call to `name` uses, minted on first use. */
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
     * made (S7): it is, if it lists `main`. Otherwise it is still being made,
     * or was undone; either way the caller tries again later.
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

    /**
     * One fork request. The base's absence names the base; any other refusal
     * names the target, and a 500 is `MaybeForked`, since it may have made it.
     */
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

    /** Whether the repo holds `id` as a blob or a commit, as a tree read refused it. */
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
            // A blob's or a commit's id names no tree, as on the other stores
            // (202 Comment 5); any other failure stays one.
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

    /** One page of a log; a ref that names nothing logs nothing, as the binding's. */
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

    const log = (name: RepoName, at: Revision, limit: number) =>
      Effect.gen(function* () {
        const commits: Commit[] = [];

        while (commits.length < limit) {
          const more = yield* page(
            name,
            refOf(at),
            commits.length,
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
      create: (name) =>
        httpPost("/repos", { name }).pipe(
          Effect.flatMap(decoded(Remote)),
          Effect.map(({ result }) => ({ name, remote: result.remote })),
          Effect.catchTag("Refused", (refused) =>
            is("ALREADY_EXISTS")(refused)
              ? Effect.fail(new RepoExists({ name }))
              : Effect.die(refused)
          )
        ),
      // S7: a 500 is tried once more; an already-exists or a second 500 after
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
      // A repo of that name still being made is a name already taken.
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
              Match.when(is("ALREADY_EXISTS", ...BEING_MADE), () =>
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
      readCommit: (name, sha) =>
        optional(
          name,
          httpGet(`${repoPath(name)}/commit/${sha}`).pipe(
            Effect.flatMap(decoded(CommitReply)),
            Effect.map(({ result }) => commitOf(result))
          )
        ),
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
    });
  });

/**
 * Artifacts over its REST API, for scripts and the bench: the same `RepoHost`
 * the platform reaches through the binding. The API token is the caller's
 * (scripts get it from `varlock run`), and goes only into the
 * `Authorization` header of requests to the API. Delete only repos the
 * caller made with it.
 */
export const RepoHostRest = {
  layer: (options: {
    readonly accountId: string;
    readonly namespace: string;
    readonly token: Redacted.Redacted;
    /** Defaults to `https://api.cloudflare.com/client/v4`. */
    readonly base?: string;
  }): Layer.Layer<RepoHost, never, Fetch> =>
    Layer.effect(RepoHost, make(options)),
};
