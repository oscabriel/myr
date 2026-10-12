import { RefName } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import type { Change } from "@repo/git/tree-diff";
import type { Verdict } from "@repo/protocol/domain/answer";
import type {
  CommitSha,
  Handle,
  LandedSha,
  RepoName,
  RepoPath,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import type {
  RepoBusy,
  StaleBase,
  VerifierBlocked,
} from "@repo/protocol/refusal";
import type { ConfigBundle } from "@repo/rules/rules-evaluator";
import { Context, Data } from "effect";
import type { Array, Effect, Option } from "effect";

export type { Change } from "@repo/git/tree-diff";

/** Moves only after `main` did, in its own push, and only to the commit `main` points at. */
export const landedRef = RefName.make(`${Brand.refsPrefix}landed`);

/** Where a composed commit waits for a Checker to fetch it by id; never `main`. */
export const composeRef = (tree: TreeSha) =>
  RefName.make(`${Brand.refsPrefix}compose/${tree}`);

export interface MergeJob {
  readonly repo: RepoName;
  readonly main: LandedSha;
  readonly base: CommitSha;
  readonly head: CommitSha;
  readonly fork: RepoName;
}

export interface Merged {
  readonly tree: TreeSha;
  /** Against its base, not main's. */
  readonly changes: readonly Change[];
}

export interface ComposedFile {
  readonly path: RepoPath;
  readonly content: string;
}

export type Rebuild = Data.TaggedEnum<{
  Merge: {
    readonly fork: RepoName;
    readonly base: CommitSha;
    readonly head: CommitSha;
  };
  Compose: { readonly files: Array.NonEmptyReadonlyArray<ComposedFile> };
  Existing: { readonly commit: CommitSha };
}>;

export const Rebuild = Data.taggedEnum<Rebuild>();

export interface LandJob {
  readonly repo: RepoName;
  /** The push's compare-and-swap: a moved `main` makes the land `StaleBase`. */
  readonly main: LandedSha;
  readonly tree: TreeSha;
  readonly author: Handle;
  /** Its `Request-Id` trailer lets a second land of the same request find the first one's commit. */
  readonly message: string;
  readonly requestId: RequestId;
  readonly rebuild: Rebuild;
  readonly verdict: Option.Option<Verdict>;
}

export type Bookkeeping = "mirror" | "notes";

/** A pending item never fails the landing; the outbox lands it again later. */
export interface Landed {
  readonly sha: LandedSha;
  readonly pending: readonly Bookkeeping[];
}

export interface ComposeJob {
  readonly repo: RepoName;
  readonly main: LandedSha;
  readonly files: Array.NonEmptyReadonlyArray<ComposedFile>;
}

export interface Composed {
  readonly tree: TreeSha;
  readonly commit: CommitSha;
}

export interface BundleJob {
  readonly repo: RepoName;
  readonly at: LandedSha;
}

export class Lander extends Context.Service<
  Lander,
  {
    readonly merge: (
      job: MergeJob
    ) => Effect.Effect<Merged, StaleBase | VerifierBlocked>;
    /** A non-force compare-and-swap push; a second land of the same request returns the first one's commit. */
    readonly land: (
      job: LandJob
    ) => Effect.Effect<Landed, StaleBase | RepoBusy | VerifierBlocked>;
    readonly compose: (
      job: ComposeJob
    ) => Effect.Effect<Composed, VerifierBlocked>;
    readonly bundleRules: (
      job: BundleJob
    ) => Effect.Effect<ConfigBundle, VerifierBlocked>;
  }
>()("project/Lander") {}
