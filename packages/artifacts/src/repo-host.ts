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

/** A repo's name in its namespace: the one `RepoName`, from the domain. */
export { RepoName } from "@repo/protocol/ids";

/** A short branch name such as `main` or `feature/x`, never `refs/…`. */
export const BranchName = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^(?!refs\/)(?!.*\.\.)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u
    )
  ),
  Schema.brand("BranchName")
);

export type BranchName = typeof BranchName.Type;

/**
 * A full ref name: `refs/heads/main`, `refs/asked/landed`, `refs/notes/commits`,
 * `refs/tags/@changesets/cli@2.27.1` (a scoped package's tag; `@` and `+`
 * are git's as well).
 */
export const RefName = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^refs\/(?!.*\.\.)[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)+$/u
    )
  ),
  Schema.brand("RefName")
);

export type RefName = typeof RefName.Type;

/** A git object id: 40 lowercase hex digits. */
export const ObjectId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9a-f]{40}$/u)),
  Schema.brand("ObjectId")
);

export type ObjectId = typeof ObjectId.Type;

/**
 * One immediate child of a git tree, as `git ls-tree` lists it: `040000` and
 * `tree` for a folder, `160000` and `commit` for a submodule.
 */
export const TreeEntry = Schema.Struct({
  mode: Schema.Literals(["100644", "100755", "120000", "040000", "160000"]),
  name: Schema.NonEmptyString,
  sha: ObjectId,
  type: Schema.Literals(["blob", "tree", "commit"]),
});

export type TreeEntry = typeof TreeEntry.Type;

/**
 * Where a read starts. Artifacts' binding resolves short branch names and
 * commit ids only, so these are the only two kinds.
 */
export type Revision = Data.TaggedEnum<{
  Branch: { readonly name: BranchName };
  Commit: { readonly sha: CommitSha };
}>;

export const Revision = Data.taggedEnum<Revision>();

const Person = Schema.Struct({ email: Schema.String, name: Schema.String });

/** A commit, with when it was written and when committed, in Unix seconds. */
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

/** One tag: its full ref, and the commit it names, peeled. */
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

/** A local git repo, read through isomorphic-git, that a push takes objects from. */
export interface PushSource {
  readonly fs: FsClient;
  readonly gitdir: string;
}

/**
 * One ref's compare-and-swap. `from` is the tip the pusher expects; `None`
 * means the ref must not exist yet.
 */
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

/** Artifacts is still forking this repo; retry. */
export class ForkInProgress extends Schema.TaggedError<ForkInProgress>()(
  "ForkInProgress",
  { name: RepoName }
) {}

/** The store would not import from that remote: not git, not public, or not reachable. */
export class ImportRefused extends Schema.TaggedError<ImportRefused>()(
  "ImportRefused",
  { name: RepoName, reason: Schema.String }
) {}

/** The store refused a whole push while busy with another; retry. */
export class HostBusy extends Schema.TaggedError<HostBusy>()("HostBusy", {
  name: RepoName,
}) {}

/**
 * The git store the platform keeps repos in. The only way to Artifacts: every
 * other package reaches it through this port.
 */
export class RepoHost extends Context.Service<
  RepoHost,
  {
    readonly create: (name: RepoName) => Effect.Effect<RepoCreated, RepoExists>;
    /**
     * A new repo holding one branch of a public remote: `branch`, or the
     * remote's default branch, under its own name.
     */
    readonly importFrom: (
      name: RepoName,
      source: { readonly url: string; readonly branch?: BranchName }
    ) => Effect.Effect<RepoCreated, RepoExists | ImportRefused>;
    /** Forks the default branch only, as Artifacts does by default. */
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
    /** The git URL that pushes and fetches go to. */
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
    /** A tree's immediate children by the tree's id; `None` when no tree has it. */
    readonly readTree: (
      name: RepoName,
      tree: ObjectId
    ) => Effect.Effect<Option.Option<readonly TreeEntry[]>, RepoNotFound>;
    /** A blob's bytes by its id; `None` when no blob has it. */
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
    /** Every ref, as `ls-remote` lists them, custom refs included. */
    readonly refs: (
      name: RepoName
    ) => Effect.Effect<ReadonlyMap<RefName, CommitSha>, RepoNotFound>;
    /**
     * Every `refs/tags/*`, each peeled to the commit it names: an annotated
     * tag's ref names a tag object, which `readCommit` cannot read.
     * `refs` keeps what git lists.
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

/**
 * What the reads of one session may share: a host keeps what it opens on a
 * repo (the binding's handle) under `key` until the session ends, rather
 * than opening and closing it for each read. One opening at a time, and
 * only a finished value is kept, so no read waits on another's opening
 * past its own session.
 */
export interface RepoSessionApi {
  readonly hold: <A, E>(
    key: string,
    open: Effect.Effect<A, E, Scope.Scope>
  ) => Effect.Effect<A, E>;
}

/**
 * The session reads run in, if any. A `Context.Reference` whose default is
 * none, so each read opens and closes what it needs, as a host without a
 * session does. It lives in one request's context, never in an isolate's
 * state: a Worker whose client goes away is cancelled where it stands, so
 * nothing a request holds may outlive it.
 */
export const RepoSession = Context.Reference<Option.Option<RepoSessionApi>>(
  "artifacts/RepoSession",
  { defaultValue: Option.none }
);

/**
 * `effect` with its reads in one session: what a host holds for them is
 * released when `effect` ends, whatever it came to. Inside a session
 * already, `effect` joins it, so a view whose parts each ask for a
 * session still reads over one handle.
 */
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
