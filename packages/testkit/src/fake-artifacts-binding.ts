/**
 * A fake of the Workers `Artifacts` binding over a repo host, for tests of
 * code that takes the binding. It keeps the surprises the spikes found in the
 * real one:
 *
 * - under `wrangler dev`, errors arrive as plain `Error`s with no `code`
 *   (S1 #22): pass `{ codeless: true }`;
 * - under load, a fork answers HTTP 500 after making the repo, and the retry
 *   answers 409 (S7 #2): pass `{ forkFailures: n }`;
 * - reads by ref resolve short branch names and commit ids only, never
 *   `refs/heads/main` (S1 #20);
 * - `info().lastPushAt` stays `null` after pushes (S1 #21).
 *
 * It takes its host structurally (`HostLike`), so `@repo/testkit` depends on
 * no adapter package: a `RepoHost` service value satisfies `HostLike`. Each
 * call runs the host's Effect with `Effect.runPromise`, since the binding is
 * a promise API; this is a test double, in a package only tests import.
 *
 * Like everything in `@repo/testkit`, this module is for `test/` directories
 * only: no `src/` imports it (`imports:check` refuses one).
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
  Schema,
} from "effect";
import { constVoid } from "effect/Function";

import { defaultNow } from "./clock.ts";

/** A git object id, branded as `@repo/artifacts`' `ObjectId` is. */
export const ObjectId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9a-f]{40}$/u)),
  Schema.brand("ObjectId")
);

export type ObjectId = typeof ObjectId.Type;

/** A short branch name, branded as `@repo/artifacts`' `BranchName` is. */
export const BranchName = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^(?!refs\/)(?!.*\.\.)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u
    )
  ),
  Schema.brand("BranchName")
);

export type BranchName = typeof BranchName.Type;

/** Where a read starts, as `@repo/artifacts`' `Revision` has it. */
export type Revision = Data.TaggedEnum<{
  Branch: { readonly name: BranchName };
  Commit: { readonly sha: CommitSha };
}>;

export const Revision = Data.taggedEnum<Revision>();

/** What a host fails with: `RepoHost`'s errors, by shape. */
export type HostError =
  | { readonly _tag: "RepoNotFound"; readonly name: RepoName }
  | { readonly _tag: "RepoExists"; readonly name: RepoName }
  | { readonly _tag: "ForkInProgress"; readonly name: RepoName }
  | {
      readonly _tag: "ImportRefused";
      readonly name: RepoName;
      readonly reason: string;
    }
  | { readonly _tag: "HostBusy"; readonly name: RepoName };

interface Person {
  readonly email: string;
  readonly name: string;
}

interface HostCommit {
  readonly author: Person;
  readonly committer: Person;
  readonly message: string;
  readonly parents: readonly string[];
  readonly sha: string;
  readonly tree: string;
}

interface HostTreeEntry {
  readonly mode: "100644" | "100755" | "120000" | "040000" | "160000";
  readonly name: string;
  readonly sha: string;
  readonly type: "blob" | "tree" | "commit";
}

interface HostCreated {
  readonly name: string;
  readonly remote: string;
}

/**
 * The `RepoHost` methods the fake calls, by shape: the same parameters, with
 * the domain's ids, and results at least as wide. A `RepoHost` service value
 * is one.
 */
export interface HostLike {
  readonly create: (name: RepoName) => Effect.Effect<HostCreated, HostError>;
  readonly importFrom: (
    name: RepoName,
    source: { readonly url: string; readonly branch?: BranchName }
  ) => Effect.Effect<HostCreated, HostError>;
  readonly fork: (
    base: RepoName,
    name: RepoName
  ) => Effect.Effect<HostCreated, HostError>;
  readonly remove: (name: RepoName) => Effect.Effect<boolean>;
  readonly mintToken: (
    name: RepoName,
    scope: "read" | "write",
    ttl: Duration.Duration
  ) => Effect.Effect<
    {
      readonly id: string;
      readonly secret: Redacted.Redacted;
      readonly scope: "read" | "write";
      readonly expiresAt: DateTime.Utc;
    },
    HostError
  >;
  readonly revokeToken: (
    name: RepoName,
    id: string
  ) => Effect.Effect<boolean, HostError>;
  readonly remote: (name: RepoName) => Effect.Effect<string, HostError>;
  readonly readFile: (
    name: RepoName,
    at: Revision,
    path: RepoPath
  ) => Effect.Effect<Option.Option<Uint8Array>, HostError>;
  readonly readCommit: (
    name: RepoName,
    sha: CommitSha
  ) => Effect.Effect<Option.Option<HostCommit>, HostError>;
  readonly readTree: (
    name: RepoName,
    tree: ObjectId
  ) => Effect.Effect<Option.Option<readonly HostTreeEntry[]>, HostError>;
  readonly readBlob: (
    name: RepoName,
    blob: ObjectId
  ) => Effect.Effect<Option.Option<Uint8Array>, HostError>;
  readonly log: (
    name: RepoName,
    at: Revision,
    limit: number
  ) => Effect.Effect<readonly HostCommit[], HostError>;
}

export interface FakeOptions {
  /** Throw plain `Error`s with no `code`, as remote bindings under `wrangler dev` do. */
  readonly codeless?: boolean;
  /** How many forks fail with a 500 after making the repo, as under load. */
  readonly forkFailures?: number;
  /** Remotes are `<remoteBase>/<name>.git`, for a git server the test runs; else the host's. */
  readonly remoteBase?: string;
}

/** A refusal the binding throws, before it becomes the thrown error. */
class Refused extends Data.TaggedError("Refused")<{
  readonly code: ArtifactsError["code"];
  readonly reason: string;
}> {}

/**
 * The REST API's numeric code for each binding code. The spikes recorded two
 * (S7: 10201 and 10400); the rest are unknown and read 0, so tests match on
 * `code`.
 */
const numericCodes = {
  ALREADY_EXISTS: 10_201,
  INTERNAL_ERROR: 10_400,
} as const;

const numericOf = (code: ArtifactsError["code"]) =>
  Match.value(code).pipe(
    Match.when("ALREADY_EXISTS", () => numericCodes.ALREADY_EXISTS),
    Match.when("INTERNAL_ERROR", () => numericCodes.INTERNAL_ERROR),
    Match.orElse(() => 0)
  );

/** A host's error as the binding words it (S1 #22, S7 #2). */
const refusalOf = (error: HostError) =>
  Match.valueTags(error, {
    ForkInProgress: ({ name }) =>
      new Refused({
        code: "FORK_IN_PROGRESS",
        reason: `Fork in progress: ${name}`,
      }),
    HostBusy: () =>
      new Refused({
        code: "INTERNAL_ERROR",
        reason: "An internal error occurred.",
      }),
    ImportRefused: ({ reason }) => new Refused({ code: "INVALID_URL", reason }),
    RepoExists: ({ name }) =>
      new Refused({
        code: "ALREADY_EXISTS",
        reason: `repo already exists: ${name}`,
      }),
    RepoNotFound: ({ name }) =>
      new Refused({
        code: "NOT_FOUND",
        reason: `Repository not found: ${name}`,
      }),
  });

/** The repos the fake made, with what `info()` and `list()` report. */
interface Kept {
  readonly id: string;
  readonly name: RepoName;
  readonly description: string | null;
  readonly defaultBranch: string;
  readonly source: string | null;
  readonly readOnly: boolean;
  readonly tokens: Map<
    string,
    ArtifactsTokenInfo & { readonly plaintext: string }
  >;
}

// Artifacts stamps repos with the time they were made; the fake with the
// scenarios' fixed instant, so two runs give the same values.
const stamped = DateTime.formatIso(defaultNow);

const isObjectId = Schema.is(ObjectId);

const decodeName = Schema.decodeUnknownOption(RepoName);

const decodeBranch = Schema.decodeUnknownOption(BranchName);

const decodePath = Schema.decodeUnknownOption(RepoPath);

/**
 * `main` → that branch; 40 hex digits → that commit; anything else, such as
 * `refs/heads/main` or a tag, resolves to nothing (S1 #20).
 */
const revisionOf = (ref: string): Option.Option<Revision> =>
  isObjectId(ref)
    ? Option.some(Revision.Commit({ sha: CommitSha.make(ref) }))
    : Option.map(decodeBranch(ref), (name) => Revision.Branch({ name }));

// Artifacts gives canonical modes: a folder is `40000`, not `040000`.
const typeOf = (entry: HostTreeEntry): ArtifactsTreeEntryType =>
  Match.value(entry.mode).pipe(
    Match.when("040000", () => "tree" as const),
    Match.when("100755", () => "exec" as const),
    Match.when("120000", () => "symlink" as const),
    Match.when("160000", () => "gitlink" as const),
    Match.orElse(() => "blob" as const)
  );

const entryOf = (entry: HostTreeEntry): ArtifactsTreeEntry => ({
  hash: entry.sha,
  mode: entry.mode.replace(/^0/u, ""),
  name: entry.name,
  type: typeOf(entry),
});

// `RepoHost`'s commits carry no times, so the fake reports the epoch.
const metadataOf = (commit: HostCommit): ArtifactsCommitMetadata => ({
  author: { email: commit.author.email, name: commit.author.name },
  authoredAt: 0,
  committedAt: 0,
  committer: { email: commit.committer.email, name: commit.committer.name },
  hash: commit.sha,
  message: commit.message,
  parents: [...commit.parents],
  treeHash: commit.tree,
});

const refuse = (code: ArtifactsError["code"], reason: string) =>
  Effect.fail(new Refused({ code, reason }));

const named = (name: string, code: ArtifactsError["code"]) =>
  Option.match(decodeName(name), {
    onNone: () => refuse(code, `Invalid repository name: ${name}`),
    onSome: Effect.succeed,
  });

const objectId = (hash: string): Effect.Effect<ObjectId, Refused> =>
  isObjectId(hash)
    ? Effect.succeed(hash)
    : refuse("INVALID_INPUT", `Invalid object id: ${hash}`);

const blobOf = (bytes: Uint8Array) =>
  new Blob([bytes], { type: "application/octet-stream" });

/** An Artifacts binding over `host`, with the real one's surprises (see the module's doc). */
export const fakeArtifactsBinding = (
  host: HostLike,
  options: FakeOptions = {}
): Artifacts => {
  const kept = new Map<RepoName, Kept>();
  let forkFailures = options.forkFailures ?? 0;
  let made = 0;

  /** The thrown error: an `ArtifactsError`, or a plain one when codeless. */
  const thrown = ({ code, reason }: Refused) =>
    options.codeless === true
      ? new Error(`ArtifactsError: ${reason}`)
      : Object.assign(new Error(reason), {
          code,
          name: "ArtifactsError" as const,
          numericCode: numericOf(code),
        });

  /** Runs one call as the binding answers: a promise, rejected with its error. */
  const run = <A>(effect: Effect.Effect<A, Refused | HostError>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.die(
              thrown(
                Match.valueTags(error, {
                  ForkInProgress: refusalOf,
                  HostBusy: refusalOf,
                  ImportRefused: refusalOf,
                  Refused: (refused) => refused,
                  RepoExists: refusalOf,
                  RepoNotFound: refusalOf,
                })
              )
            ),
          onSuccess: Effect.succeed,
        })
      )
    );

  const remoteOf = (name: RepoName) =>
    options.remoteBase === undefined
      ? host.remote(name)
      : host.remote(name).pipe(Effect.as(`${options.remoteBase}/${name}.git`));

  const keep = (
    name: RepoName,
    fields: Partial<Pick<Kept, "description" | "defaultBranch" | "source">>
  ) => {
    made += 1;

    const repo: Kept = {
      defaultBranch: fields.defaultBranch ?? "main",
      description: fields.description ?? null,
      id: `repo-${String(made).padStart(6, "0")}`,
      name,
      readOnly: false,
      source: fields.source ?? null,
      tokens: new Map(),
    };

    kept.set(name, repo);

    return repo;
  };

  /** What `info()` shows for a repo the fake did not make itself. */
  const keptOf = (name: RepoName) => kept.get(name) ?? keep(name, {});

  const mint = (name: RepoName, scope: "read" | "write", seconds: number) =>
    host.mintToken(name, scope, Duration.seconds(seconds)).pipe(
      Effect.map((token) => {
        const plaintext = Redacted.value(token.secret);
        const expiresAt = DateTime.formatIso(token.expiresAt);

        keptOf(name).tokens.set(token.id, {
          createdAt: stamped,
          expiresAt,
          id: token.id,
          plaintext,
          scope,
          state: "active",
        });

        return { expiresAt, id: token.id, plaintext, scope: token.scope };
      })
    );

  /** A new repo's result: its metadata, its remote and a day-long write token (S1 #2). */
  const createdOf = (repo: Kept) =>
    Effect.gen(function* () {
      const remote = yield* remoteOf(repo.name);
      const token = yield* mint(repo.name, "write", 86_400);

      return {
        defaultBranch: repo.defaultBranch,
        description: repo.description,
        id: repo.id,
        name: repo.name,
        remote,
        token: token.plaintext,
      };
    });

  /** What `list()` shows of a repo; `info()` adds its remote. */
  const summaryOf = (repo: Kept): Omit<ArtifactsRepoInfo, "remote"> => ({
    createdAt: stamped,
    defaultBranch: repo.defaultBranch,
    description: repo.description,
    id: repo.id,
    // Still null after pushes (S1 #21).
    lastPushAt: null,
    name: repo.name,
    readOnly: repo.readOnly,
    source: repo.source,
    updatedAt: stamped,
  });

  const info = (repo: Kept) =>
    remoteOf(repo.name).pipe(
      Effect.map((remote): ArtifactsRepoInfo => ({
        ...summaryOf(repo),
        remote,
      }))
    );

  const handle = (name: RepoName): ArtifactsRepo => ({
    createToken: (scope = "write", ttl = 86_400) =>
      run(
        ttl < 60 || ttl > 31_536_000
          ? refuse("INVALID_TTL", `ttl must be between 60 and 31536000: ${ttl}`)
          : mint(name, scope, ttl).pipe(
              Effect.map(({ expiresAt, id, plaintext }) => ({
                expiresAt,
                id,
                plaintext,
                scope,
              }))
            )
      ),
    fork: (target, forkOptions) =>
      run(
        Effect.gen(function* () {
          const fork = yield* named(target, "INVALID_REPO_NAME");

          yield* host.fork(name, fork);

          const repo = keep(fork, {
            description: forkOptions?.description ?? null,
            source: `artifacts:fake/${name}`,
          });

          if (forkFailures > 0) {
            forkFailures -= 1;

            return yield* refuse(
              "INTERNAL_ERROR",
              "An internal error occurred."
            );
          }

          return yield* createdOf(repo);
        })
      ),
    info: () => run(info(keptOf(name))),
    listTokens: () =>
      run(
        host.remote(name).pipe(
          Effect.map(() => {
            const tokens = [...keptOf(name).tokens.values()].map(
              ({ createdAt, expiresAt, id, scope, state }) => ({
                createdAt,
                expiresAt,
                id,
                scope,
                state,
              })
            );

            return { tokens, total: tokens.length };
          })
        )
      ),
    log: (logOptions) =>
      run(
        Effect.gen(function* () {
          const ref = logOptions?.ref ?? "HEAD";
          const limit = Math.min(logOptions?.limit ?? 50, 1000);
          const offset = logOptions?.offset ?? 0;

          const at =
            ref === "HEAD"
              ? Option.some(
                  Revision.Branch({
                    name: BranchName.make(keptOf(name).defaultBranch),
                  })
                )
              : revisionOf(ref);

          if (Option.isNone(at)) {
            return [];
          }

          const commits = yield* host.log(name, at.value, offset + limit);

          return commits.slice(offset).map(metadataOf);
        })
      ),
    readBlob: (hash) =>
      run(
        objectId(hash).pipe(
          Effect.flatMap((blob) => host.readBlob(name, blob)),
          Effect.map((bytes) => Option.getOrNull(Option.map(bytes, blobOf)))
        )
      ),
    readCommit: (hash) =>
      run(
        objectId(hash).pipe(
          Effect.flatMap((sha) => host.readCommit(name, CommitSha.make(sha))),
          Effect.map((commit) =>
            Option.getOrNull(Option.map(commit, metadataOf))
          )
        )
      ),
    readFile: ({ path, ref }) =>
      run(
        Effect.gen(function* () {
          const file = decodePath(path);
          const at = revisionOf(ref);

          if (ref === "" || Option.isNone(file)) {
            return yield* refuse(
              "INVALID_INPUT",
              "ref and path must not be empty"
            );
          }

          if (Option.isNone(at)) {
            return null;
          }

          const bytes = yield* host.readFile(name, at.value, file.value);

          return Option.getOrNull(Option.map(bytes, blobOf));
        })
      ),
    readTree: (hash) =>
      run(
        objectId(hash).pipe(
          Effect.flatMap((tree) => host.readTree(name, tree)),
          Effect.map((entries) =>
            Option.getOrNull(Option.map(entries, (each) => each.map(entryOf)))
          )
        )
      ),
    revokeToken: (tokenOrId) =>
      run(
        Effect.gen(function* () {
          if (tokenOrId === "") {
            return yield* refuse(
              "INVALID_INPUT",
              "tokenOrId must not be empty"
            );
          }

          const { tokens } = keptOf(name);

          const token = [...tokens.values()].find(
            ({ id, plaintext }) => id === tokenOrId || plaintext === tokenOrId
          );

          const revoked = yield* host.revokeToken(name, token?.id ?? tokenOrId);

          if (token !== undefined && revoked) {
            tokens.set(token.id, { ...token, state: "revoked" });
          }

          return revoked;
        })
      ),
    [Symbol.dispose]: constVoid,
  });

  return {
    create: (name, createOptions) =>
      run(
        Effect.gen(function* () {
          const repoName = yield* named(name, "INVALID_REPO_NAME");

          yield* host.create(repoName);

          return yield* createdOf(
            keep(repoName, {
              defaultBranch: createOptions?.setDefaultBranch ?? "main",
              description: createOptions?.description ?? null,
            })
          );
        })
      ),
    delete: (name) =>
      run(
        Effect.gen(function* () {
          const repoName = yield* named(name, "INVALID_REPO_NAME");

          kept.delete(repoName);

          return yield* host.remove(repoName);
        })
      ),
    get: (name) =>
      run(
        Effect.gen(function* () {
          const repoName = yield* named(name, "NOT_FOUND");

          yield* host.remote(repoName);

          return handle(repoName);
        })
      ),
    import: ({ source, target }) =>
      run(
        Effect.gen(function* () {
          const repoName = yield* named(target.name, "INVALID_REPO_NAME");

          const branch = Option.fromNullishOr(source.branch).pipe(
            Option.flatMap(decodeBranch)
          );

          yield* host.importFrom(
            repoName,
            Option.match(branch, {
              onNone: () => ({ url: source.url }),
              onSome: (name) => ({ branch: name, url: source.url }),
            })
          );

          return yield* createdOf(
            keep(repoName, {
              description: target.opts?.description ?? null,
              source: source.url,
            })
          );
        })
      ),
    list: (listOptions) =>
      run(
        Effect.sync(() => {
          const limit = Math.min(Math.max(listOptions?.limit ?? 50, 1), 200);
          const from = Number(listOptions?.cursor ?? "0");
          const all = [...kept.values()];

          const repos = all.slice(from, from + limit).map(summaryOf);
          const next = from + limit;

          return next < all.length
            ? { cursor: String(next), repos, total: all.length }
            : { repos, total: all.length };
        })
      ),
  };
};
