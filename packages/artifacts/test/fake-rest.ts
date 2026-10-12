/**
 * An in-process fake of the Artifacts REST API over a `RepoHost`. It keeps
 * what Artifacts' REST docs and probes say of the real API; what the docs
 * leave out (commit field casing, a wrong-kind read as 500, a log at a ref
 * that names nothing as 404) is an ASSUMPTION nobody has seen live.
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
  readonly token: string;
  readonly base?: string;
  readonly forkFailures?: number;
  readonly forkLost?: boolean;
  readonly casing?: "camel" | "snake";
  readonly revokeLag?: number;
}

const Codes = {
  alreadyExists: 10_201,
  forkInProgress: 10_303,
  internal: 10_400,
  invalidInput: 10_100,
  invalidTtl: 10_103,
  invalidUrl: 10_104,
  notFound: 10_200,
} as const;

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

class Answered extends Data.TaggedError("Answered")<{
  readonly response: Response;
}> {}

const invalid = (code: number, message: string) =>
  new Answered({ response: failed(400, code, message) });

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

interface Minted {
  readonly repo: RepoName;
  readonly misses: number;
}

interface Call {
  readonly name: string;
  readonly id: string;
  readonly request: Request;
  readonly url: URL;
}

type Handler = (call: Call) => Effect.Effect<Response, Failure>;

export const fakeRest = (
  host: RepoHost["Service"],
  options: FakeRestOptions
): Effect.Effect<(request: Request) => Effect.Effect<Response>> =>
  Effect.gen(function* () {
    const apiBase = options.base ?? "https://api.cloudflare.com/client/v4";
    const prefix = `${apiBase}/accounts/${options.accountId}/artifacts/namespaces/${options.namespace}`;
    const forkFailures = yield* Ref.make(options.forkFailures ?? 0);
    const tokens = yield* Ref.make<ReadonlyMap<string, Minted>>(new Map());

    const metadataOf = (commit: Commit) => {
      const fields = {
        author: commit.author,
        committer: commit.committer,
        hash: commit.sha,
        message: commit.message,
        parents: commit.parents,
      };

      return options.casing === "camel"
        ? {
            ...fields,
            authoredAt: commit.authoredAt,
            committedAt: commit.committedAt,
            treeHash: commit.tree,
          }
        : {
            ...fields,
            authored_at: commit.authoredAt,
            committed_at: commit.committedAt,
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
