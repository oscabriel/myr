/**
 * An in-process fake of the Artifacts REST API over a `RepoHost` (in tests,
 * `RepoHostLocal`), for `/rest`'s tests. It serves the routes
 * `src/repo-host/rest.ts` lists, under
 * `<base>/accounts/<accountId>/artifacts/namespaces/<namespace>`, and answers
 * in Cloudflare's v4 envelope, `{success, errors: [{code, message}],
 * messages, result}`. A repo's `remote` is the host's, for a git server the
 * test runs there (`@repo/testkit/http-backend`).
 *
 * It keeps what Artifacts' REST docs and the probes say of the real API:
 *
 * - only `Authorization: Bearer <api token>` authenticates; anything else is
 *   401 (Cloudflare's code 10000);
 * - errors carry Artifacts' numeric codes (its errors page): 10200 not
 *   found, 10201 already exists, 10303 fork in progress, 10100 invalid
 *   input, 10103 invalid ttl, 10104 invalid url, 10400 internal;
 * - a fork names its target in the body, `{name, default_branch_only}`, a
 *   field cf's schema lacks (cf #180); a body without `name` is refused;
 * - create, fork and import answer with the new repo's `remote` and a
 *   day-long write token; a token's mint answers `{id, plaintext,
 *   scope, expires_at}`; a delete answers 202;
 * - under load, a fork answers HTTP 500 with code 10400 after making the
 *   repo, and a retry answers 409 with code 10201:
 *   `{ forkFailures: n }`; `{ forkLost: true }` makes those forks make
 *   nothing;
 * - revoking a token within about a second of its mint can be 404 (cf's
 *   help for `tokens revoke`): `{ revokeLag: n }` makes the first `n`
 *   revocations of each token 404;
 * - blobs and files are raw bytes; every other reply is JSON.
 *
 * And, as ASSUMPTIONs nobody has seen live, what the docs leave out:
 *
 * - commit metadata is the binding's, in snake case (`tree_hash`) as the
 *   API's other fields are, or in camel case: `{ casing: "camel" }`;
 * - a tree or a log is the binding's list, as the envelope's `result`;
 * - a tree or a commit read at an object of another kind is 500 (10400), as
 *   the binding throws `INTERNAL_ERROR` there;
 * - a ref is a short branch name or a commit id, as the binding's,
 *   and a log at a ref that names nothing is 404.
 */
import { CommitSha, RepoName, RepoPath } from "@repo/protocol/ids";
import {
  Data,
  DateTime,
  Duration,
  Effect,
  Match,
  Option,
  Redacted,
  Ref,
  Schema,
} from "effect";

import { BranchName, ObjectId, Revision } from "../src/repo-host.ts";
import type {
  Commit,
  ForkInProgress,
  ImportRefused,
  RepoExists,
  RepoHost,
  RepoNotFound,
  TokenScope,
  TreeEntry,
} from "../src/repo-host.ts";

export interface FakeRestOptions {
  readonly accountId: string;
  readonly namespace: string;
  /** The API token it takes, as a bearer token. */
  readonly token: string;
  /** Defaults to `https://api.cloudflare.com/client/v4`. */
  readonly base?: string;
  /** How many fork calls answer 500 (code 10400), as under load. */
  readonly forkFailures?: number;
  /** Whether those forks make nothing; by default each makes the repo first. */
  readonly forkLost?: boolean;
  /** How commit metadata spells its fields; snake case by default. */
  readonly casing?: "camel" | "snake";
  /** How many revocations of each token answer 404 before one takes. */
  readonly revokeLag?: number;
}

/** Artifacts' error codes, from its errors page. */
const Codes = {
  alreadyExists: 10_201,
  forkInProgress: 10_303,
  internal: 10_400,
  invalidInput: 10_100,
  invalidTtl: 10_103,
  invalidUrl: 10_104,
  notFound: 10_200,
} as const;

/** Cloudflare's own codes for a bad API token and an unknown route. */
const UNAUTHENTICATED = 10_000;

const NO_ROUTE = 7000;

const DAY_SECONDS = 86_400;

const ok = (result: Schema.Json, status = 200) =>
  Response.json(
    { errors: [], messages: [], result, success: true },
    { status }
  );

const failed = (status: number, code: number, message: string) =>
  Response.json(
    { errors: [{ code, message }], messages: [], result: null, success: false },
    { status }
  );

const raw = (bytes: Uint8Array) =>
  new Response(new Uint8Array(bytes), {
    headers: { "content-type": "application/octet-stream" },
  });

const notFound = (what: string) =>
  failed(404, Codes.notFound, `${what} not found`);

const internal = () =>
  failed(500, Codes.internal, "An internal error occurred.");

/** A reply decided before the host was asked: a refusal of the request itself. */
class Answered extends Data.TaggedError("Answered")<{
  readonly response: Response;
}> {}

const invalid = (code: number, message: string) =>
  new Answered({ response: failed(400, code, message) });

/** What a route's handler fails with: the host's errors, or a reply. */
type Failure =
  | Answered
  | ForkInProgress
  | ImportRefused
  | RepoExists
  | RepoNotFound;

const CreateBody = Schema.fromJsonString(Schema.Struct({ name: RepoName }));

const ForkBody = Schema.fromJsonString(
  Schema.Struct({
    default_branch_only: Schema.optionalKey(Schema.Boolean),
    name: RepoName,
  })
);

const ImportBody = Schema.fromJsonString(
  Schema.Struct({ branch: Schema.optionalKey(BranchName), url: Schema.String })
);

const TokenBody = Schema.fromJsonString(
  Schema.Struct({
    repo: RepoName,
    scope: Schema.optionalKey(Schema.Literals(["read", "write"])),
    ttl: Schema.optionalKey(Schema.Int),
  })
);

const decodeName = Schema.decodeUnknownOption(RepoName);

const decodeObject = Schema.decodeUnknownOption(ObjectId);

const decodeBranch = Schema.decodeUnknownOption(BranchName);

const decodePath = Schema.decodeUnknownOption(RepoPath);

/** A request's JSON body, decoded, or a 400. */
const bodyOf = <A>(request: Request, codec: Schema.Codec<A, string>) =>
  Effect.promise(() => request.text()).pipe(
    Effect.flatMap(Schema.decodeEffect(codec)),
    Effect.mapError(() => invalid(Codes.invalidInput, "invalid request body"))
  );

const repoNamed = (name: string) =>
  Effect.fromOption(decodeName(name)).pipe(
    Effect.mapError(() =>
      invalid(Codes.invalidInput, `invalid repo name: ${name}`)
    )
  );

const objectNamed = (id: string) =>
  Effect.fromOption(decodeObject(id)).pipe(
    Effect.mapError(() => invalid(Codes.invalidInput, `invalid hash: ${id}`))
  );

/** A short branch name or a commit id; anything else names nothing. */
const revisionOf = (ref: string): Option.Option<Revision> =>
  Option.match(decodeObject(ref), {
    onNone: () =>
      Option.map(decodeBranch(ref), (name) => Revision.Branch({ name })),
    onSome: (sha) => Option.some(Revision.Commit({ sha: CommitSha.make(sha) })),
  });

// Artifacts gives canonical modes, a folder as `40000`, and a kind derived
// from the mode (workers-types' `ArtifactsTreeEntry`).
const entryOf = (entry: TreeEntry) => ({
  hash: entry.sha,
  mode: entry.mode.replace(/^0/u, ""),
  name: entry.name,
  type: Match.value(entry.mode).pipe(
    Match.when("040000", () => "tree"),
    Match.when("100755", () => "exec"),
    Match.when("120000", () => "symlink"),
    Match.when("160000", () => "gitlink"),
    Match.orElse(() => "blob")
  ),
});

/** Whether the repo holds `id` as an object of any kind. */
const holds = (host: RepoHost["Service"], name: RepoName, id: ObjectId) =>
  Effect.all([
    host.readBlob(name, id),
    host.readTree(name, id),
    host.readCommit(name, CommitSha.make(id)),
  ]).pipe(
    Effect.map(
      ([blob, tree, commit]) =>
        Option.isSome(blob) || Option.isSome(tree) || Option.isSome(commit)
    )
  );

/** A repo's info, as `GET /repos/{name}` gives it. */
const infoOf = (name: RepoName, remote: string) =>
  ok({
    created_at: "2026-10-07T00:00:00.000Z",
    default_branch: "main",
    description: null,
    id: `repo-${name}`,
    last_push_at: null,
    name,
    read_only: false,
    remote,
    source: null,
    updated_at: "2026-10-07T00:00:00.000Z",
  });

/** Whose a token is, and how many more revocations of it miss. */
interface Minted {
  readonly repo: RepoName;
  readonly misses: number;
}

/** A route's path parameters, the request, and its URL. */
interface Call {
  readonly name: string;
  readonly id: string;
  readonly request: Request;
  readonly url: URL;
}

type Handler = (call: Call) => Effect.Effect<Response, Failure>;

/** The fake API over `host`: a handler for the test's `Fetch` to route to. */
export const fakeRest = (
  host: RepoHost["Service"],
  options: FakeRestOptions
): Effect.Effect<(request: Request) => Effect.Effect<Response>> =>
  Effect.gen(function* () {
    const apiBase = options.base ?? "https://api.cloudflare.com/client/v4";
    const prefix = `${apiBase}/accounts/${options.accountId}/artifacts/namespaces/${options.namespace}`;
    const forkFailures = yield* Ref.make(options.forkFailures ?? 0);
    const tokens = yield* Ref.make<ReadonlyMap<string, Minted>>(new Map());

    // `RepoHost`'s commits carry no times, so the fake reports the epoch.
    const metadataOf = (commit: Commit) => {
      const fields = {
        author: commit.author,
        committer: commit.committer,
        hash: commit.sha,
        message: commit.message,
        parents: commit.parents,
      };

      return options.casing === "camel"
        ? { ...fields, authoredAt: 0, committedAt: 0, treeHash: commit.tree }
        : {
            ...fields,
            authored_at: 0,
            committed_at: 0,
            tree_hash: commit.tree,
          };
    };

    const mint = (repo: RepoName, scope: TokenScope, seconds: number) =>
      Effect.gen(function* () {
        const token = yield* host.mintToken(
          repo,
          scope,
          Duration.seconds(seconds)
        );

        yield* Ref.update(tokens, (all) =>
          new Map(all).set(token.id, { misses: options.revokeLag ?? 0, repo })
        );

        return {
          expires_at: DateTime.formatIso(token.expiresAt),
          id: token.id,
          plaintext: Redacted.value(token.secret),
          scope,
        };
      });

    /** A new repo's reply, with its day-long write token. */
    const made = (name: RepoName, remote: string) =>
      mint(name, "write", DAY_SECONDS).pipe(
        Effect.map(({ plaintext }) => ({
          default_branch: "main",
          description: null,
          id: `repo-${name}`,
          name,
          remote,
          token: plaintext,
        }))
      );

    const create: Handler = ({ request }) =>
      bodyOf(request, CreateBody).pipe(
        Effect.flatMap(({ name }) => host.create(name)),
        Effect.flatMap(({ name, remote }) => made(name, remote)),
        Effect.map((result) => ok(result))
      );

    const info: Handler = (call) =>
      repoNamed(call.name).pipe(
        Effect.flatMap((name) =>
          host.remote(name).pipe(Effect.map((remote) => infoOf(name, remote)))
        )
      );

    const remove: Handler = (call) =>
      repoNamed(call.name).pipe(
        Effect.flatMap((name) =>
          host
            .remove(name)
            .pipe(
              Effect.map((removed) =>
                removed ? ok({ id: `repo-${name}` }, 202) : notFound("repo")
              )
            )
        )
      );

    const fork: Handler = (call) =>
      Effect.gen(function* () {
        const base = yield* repoNamed(call.name);
        const { name } = yield* bodyOf(call.request, ForkBody);

        const failing = yield* Ref.modify(
          forkFailures,
          (left) => [left > 0, Math.max(left - 1, 0)] as const
        );

        // The 500 comes after the repo is made, unless it is lost.
        if (failing) {
          if (options.forkLost !== true) {
            yield* host.fork(base, name).pipe(Effect.ignore);
          }

          return internal();
        }

        const { remote } = yield* host.fork(base, name);

        return ok({ ...(yield* made(name, remote)), objects: 0 });
      });

    const importFrom: Handler = (call) =>
      Effect.gen(function* () {
        const name = yield* repoNamed(call.name);
        const body = yield* bodyOf(call.request, ImportBody);
        const { remote } = yield* host.importFrom(name, body);

        return ok(yield* made(name, remote));
      });

    /** A commit or a tree; another kind of object at the id is a 500. */
    const object =
      <A>(
        read: (
          name: RepoName,
          id: ObjectId
        ) => Effect.Effect<Option.Option<A>, RepoNotFound>,
        reply: (found: A) => Response
      ): Handler =>
      (call) =>
        Effect.gen(function* () {
          const name = yield* repoNamed(call.name);
          const id = yield* objectNamed(call.id);
          const found = yield* read(name, id);

          if (Option.isSome(found)) {
            return reply(found.value);
          }

          return (yield* holds(host, name, id))
            ? internal()
            : notFound("object");
        });

    const commit = object(
      (name, id) => host.readCommit(name, CommitSha.make(id)),
      (found) => ok(metadataOf(found))
    );

    const tree = object(host.readTree, (entries) => ok(entries.map(entryOf)));

    const blob: Handler = (call) =>
      Effect.gen(function* () {
        const name = yield* repoNamed(call.name);
        const id = yield* objectNamed(call.id);

        return Option.match(yield* host.readBlob(name, id), {
          onNone: () => notFound("object"),
          onSome: raw,
        });
      });

    /** A file at a ref that is a short branch name or a commit id. */
    const file: Handler = (call) =>
      Effect.gen(function* () {
        const name = yield* repoNamed(call.name);
        const at = revisionOf(call.url.searchParams.get("ref") ?? "");
        const path = decodePath(call.url.searchParams.get("path"));

        if (Option.isNone(path)) {
          return yield* invalid(Codes.invalidInput, "path is required");
        }

        if (Option.isNone(at)) {
          yield* host.remote(name);

          return notFound("File");
        }

        return Option.match(yield* host.readFile(name, at.value, path.value), {
          onNone: () => notFound("File"),
          onSome: raw,
        });
      });

    const log: Handler = (call) =>
      Effect.gen(function* () {
        const name = yield* repoNamed(call.name);
        const ref = call.url.searchParams.get("ref") ?? "HEAD";
        const at = revisionOf(ref === "HEAD" ? "main" : ref);
        const offset = Number(call.url.searchParams.get("offset") ?? 0);
        const limit = Number(call.url.searchParams.get("limit") ?? 50);

        if (Option.isNone(at)) {
          yield* host.remote(name);

          return notFound("ref");
        }

        const commits = yield* host.log(name, at.value, offset + limit);

        return ok(commits.slice(offset).map(metadataOf));
      });

    const token: Handler = ({ request }) =>
      Effect.gen(function* () {
        const body = yield* bodyOf(request, TokenBody);
        const ttl = body.ttl ?? DAY_SECONDS;

        if (ttl < 60 || ttl > 31_536_000) {
          return yield* invalid(Codes.invalidTtl, `invalid ttl: ${ttl}`);
        }

        return ok(yield* mint(body.repo, body.scope ?? "write", ttl));
      });

    const revoke: Handler = ({ id }) =>
      Effect.gen(function* () {
        const minted = (yield* Ref.get(tokens)).get(id);

        if (minted === undefined) {
          return notFound("token");
        }

        if (minted.misses > 0) {
          yield* Ref.update(tokens, (all) =>
            new Map(all).set(id, { ...minted, misses: minted.misses - 1 })
          );

          return notFound("token");
        }

        const revoked = yield* host
          .revokeToken(minted.repo, id)
          .pipe(Effect.catchTag("RepoNotFound", () => Effect.succeed(false)));

        return revoked ? ok({ id }) : notFound("token");
      });

    const routes: readonly (readonly [string, RegExp, Handler])[] = [
      ["POST", /^\/repos$/u, create],
      ["GET", /^\/repos\/(?<name>[^/]+)$/u, info],
      ["DELETE", /^\/repos\/(?<name>[^/]+)$/u, remove],
      ["POST", /^\/repos\/(?<name>[^/]+)\/fork$/u, fork],
      ["POST", /^\/repos\/(?<name>[^/]+)\/import$/u, importFrom],
      ["GET", /^\/repos\/(?<name>[^/]+)\/commit\/(?<id>[^/]+)$/u, commit],
      ["GET", /^\/repos\/(?<name>[^/]+)\/tree\/(?<id>[^/]+)$/u, tree],
      ["GET", /^\/repos\/(?<name>[^/]+)\/blob\/(?<id>[^/]+)$/u, blob],
      ["GET", /^\/repos\/(?<name>[^/]+)\/file$/u, file],
      ["GET", /^\/repos\/(?<name>[^/]+)\/log$/u, log],
      ["POST", /^\/tokens$/u, token],
      ["DELETE", /^\/tokens\/(?<id>[^/]+)$/u, revoke],
    ];

    /** The handler for a request, and the call it is given. */
    const routed = (request: Request) => {
      const url = new URL(request.url);
      const path = `${url.origin}${url.pathname}`;

      if (!path.startsWith(`${prefix}/`)) {
        return Option.none();
      }

      return Option.firstSomeOf(
        routes.map(([method, pattern, handler]) => {
          const found = pattern.exec(path.slice(prefix.length));

          return method === request.method && found !== null
            ? Option.some({
                call: {
                  id: decodeURIComponent(found.groups?.id ?? ""),
                  name: decodeURIComponent(found.groups?.name ?? ""),
                  request,
                  url,
                },
                handler,
              })
            : Option.none();
        })
      );
    };

    return (request: Request) => {
      if (request.headers.get("authorization") !== `Bearer ${options.token}`) {
        return Effect.succeed(
          failed(401, UNAUTHENTICATED, "Authentication error")
        );
      }

      return Option.match(routed(request), {
        onNone: () =>
          Effect.succeed(failed(404, NO_ROUTE, "No route for that URI")),
        onSome: ({ call, handler }) =>
          handler(call).pipe(
            Effect.catchTags({
              Answered: ({ response }) => Effect.succeed(response),
              ForkInProgress: ({ name }) =>
                Effect.succeed(
                  failed(409, Codes.forkInProgress, `fork in progress: ${name}`)
                ),
              ImportRefused: ({ reason }) =>
                Effect.succeed(failed(400, Codes.invalidUrl, reason)),
              RepoExists: ({ name }) =>
                Effect.succeed(
                  failed(
                    409,
                    Codes.alreadyExists,
                    `repo already exists: ${name}`
                  )
                ),
              RepoNotFound: () => Effect.succeed(notFound("repo")),
            })
          ),
      });
    };
  });
