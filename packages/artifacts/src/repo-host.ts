import { CommitSha, RepoName } from "@repo/protocol/ids";
import type { RepoPath } from "@repo/protocol/ids";
import {
  Context,
  Data,
  Effect,
  Option,
  Schema,
  Scope,
  Semaphore,
} from "effect";
import type { Array, DateTime, Duration, Redacted } from "effect";
import type { FsClient } from "isomorphic-git";

export { RepoName } from "@repo/protocol/ids";

export const BranchName = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^(?!refs\/)(?!.*\.\.)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u
    )
  ),
  Schema.brand("BranchName")
);

export type BranchName = typeof BranchName.Type;

export const RefName = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^refs\/(?!.*\.\.)[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)+$/u
    )
  ),
  Schema.brand("RefName")
);

export type RefName = typeof RefName.Type;

export const ObjectId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9a-f]{40}$/u)),
  Schema.brand("ObjectId")
);

export type ObjectId = typeof ObjectId.Type;

export const TreeEntry = Schema.Struct({
  mode: Schema.Literals(["100644", "100755", "120000", "040000", "160000"]),
  name: Schema.NonEmptyString,
  sha: ObjectId,
  type: Schema.Literals(["blob", "tree", "commit"]),
});

export type TreeEntry = typeof TreeEntry.Type;

/** Artifacts' binding resolves short branch names and commit ids only. */
export type Revision = Data.TaggedEnum<{
  Branch: { readonly name: BranchName };
  Commit: { readonly sha: CommitSha };
}>;

export const Revision = Data.taggedEnum<Revision>();

const Person = Schema.Struct({ email: Schema.String, name: Schema.String });

export const Commit = Schema.Struct({
  author: Person,
  authoredAt: Schema.Int,
  committedAt: Schema.Int,
  committer: Person,
  message: Schema.String,
  parents: Schema.Array(CommitSha),
  sha: CommitSha,
  tree: ObjectId,
});

export type Commit = typeof Commit.Type;

export interface Tag {
  readonly name: RefName;
  readonly sha: CommitSha;
}

export type TokenScope = "read" | "write";

export interface RepoToken {
  readonly id: string;
  readonly secret: Redacted.Redacted;
  readonly scope: TokenScope;
  readonly expiresAt: DateTime.Utc;
}

export interface RepoCreated {
  readonly name: RepoName;
  readonly remote: string;
}

export interface PushSource {
  readonly fs: FsClient;
  readonly gitdir: string;
}

export interface RefUpdate {
  readonly ref: RefName;
  readonly from: Option.Option<CommitSha>;
  readonly to: CommitSha;
}

/** What one ref in a push came to. A push is never atomic across refs. */
export type RefOutcome = Data.TaggedEnum<{
  Updated: { readonly ref: RefName };
  Stale: { readonly ref: RefName; readonly tip: Option.Option<CommitSha> };
}>;

export const RefOutcome = Data.taggedEnum<RefOutcome>();

export class RepoNotFound extends Schema.TaggedError<RepoNotFound>()(
  "RepoNotFound",
  { name: RepoName }
) {}

export class RepoExists extends Schema.TaggedError<RepoExists>()("RepoExists", {
  name: RepoName,
}) {}

export class ForkInProgress extends Schema.TaggedError<ForkInProgress>()(
  "ForkInProgress",
  { name: RepoName }
) {}

export class ImportRefused extends Schema.TaggedError<ImportRefused>()(
  "ImportRefused",
  { name: RepoName, reason: Schema.String }
) {}

export class HostBusy extends Schema.TaggedError<HostBusy>()("HostBusy", {
  name: RepoName,
}) {}

export class RepoHost extends Context.Service<
  RepoHost,
  {
    readonly create: (name: RepoName) => Effect.Effect<RepoCreated, RepoExists>;
    readonly importFrom: (
      name: RepoName,
      source: { readonly url: string; readonly branch?: BranchName }
    ) => Effect.Effect<RepoCreated, RepoExists | ImportRefused>;
    readonly fork: (
      base: RepoName,
      name: RepoName
    ) => Effect.Effect<RepoCreated, RepoNotFound | RepoExists | ForkInProgress>;
    readonly remove: (name: RepoName) => Effect.Effect<boolean>;
    readonly mintToken: (
      name: RepoName,
      scope: TokenScope,
      ttl: Duration.Duration
    ) => Effect.Effect<RepoToken, RepoNotFound>;
    readonly revokeToken: (
      name: RepoName,
      id: string
    ) => Effect.Effect<boolean, RepoNotFound>;
    readonly remote: (name: RepoName) => Effect.Effect<string, RepoNotFound>;
    readonly readFile: (
      name: RepoName,
      at: Revision,
      path: RepoPath
    ) => Effect.Effect<Option.Option<Uint8Array>, RepoNotFound>;
    readonly readCommit: (
      name: RepoName,
      sha: CommitSha
    ) => Effect.Effect<Option.Option<Commit>, RepoNotFound>;
    readonly readTree: (
      name: RepoName,
      tree: ObjectId
    ) => Effect.Effect<Option.Option<readonly TreeEntry[]>, RepoNotFound>;
    readonly readBlob: (
      name: RepoName,
      blob: ObjectId
    ) => Effect.Effect<Option.Option<Uint8Array>, RepoNotFound>;
    /** First parents from `at`, newest first, the first `offset` (0 when absent) skipped. */
    readonly log: (
      name: RepoName,
      at: Revision,
      limit: number,
      offset?: number
    ) => Effect.Effect<readonly Commit[], RepoNotFound>;
    readonly refs: (
      name: RepoName
    ) => Effect.Effect<ReadonlyMap<RefName, CommitSha>, RepoNotFound>;
    /**
     * Each tag peeled to its commit: an annotated tag's ref names a tag
     * object, which `readCommit` cannot read.
     */
    readonly tags: (
      name: RepoName
    ) => Effect.Effect<readonly Tag[], RepoNotFound>;
    readonly push: (
      name: RepoName,
      source: PushSource,
      updates: Array.NonEmptyReadonlyArray<RefUpdate>
    ) => Effect.Effect<readonly RefOutcome[], RepoNotFound | HostBusy>;
  }
>()("artifacts/RepoHost") {}

export interface RepoSessionApi {
  readonly hold: <A, E>(
    key: string,
    open: Effect.Effect<A, E, Scope.Scope>
  ) => Effect.Effect<A, E>;
}

/**
 * Lives in one request's context, never in isolate state: a Worker whose
 * client goes away is cancelled where it stands, so nothing may outlive it.
 */
export const RepoSession = Context.Reference<Option.Option<RepoSessionApi>>(
  "artifacts/RepoSession",
  { defaultValue: Option.none }
);

export const inRepoSession = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> =>
  Effect.scoped(
    Effect.gen(function* () {
      if (Option.isSome(yield* RepoSession)) {
        return yield* effect;
      }

      const scope = yield* Effect.scope;
      const opening = yield* Semaphore.make(1);
      const held = new Map<string, unknown>();

      const session: RepoSessionApi = {
        hold: <B, F>(key: string, open: Effect.Effect<B, F, Scope.Scope>) =>
          opening.withPermits(1)(
            Effect.suspend(() => {
              if (held.has(key)) {
                // SAFETY: each key names one kind of value, which a caller
                // opens with one effect, so what it holds is a `B`.
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one session holds every kind of value, so its map is typed `unknown`; see SAFETY.
                return Effect.succeed(held.get(key) as B);
              }

              return Effect.tap(Scope.provide(open, scope), (value) =>
                Effect.sync(() => {
                  held.set(key, value);
                })
              );
            })
          ),
      };

      return yield* Effect.provideService(
        effect,
        RepoSession,
        Option.some(session)
      );
    })
  );
