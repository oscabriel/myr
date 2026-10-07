/**
 * The `Lander` port (spec §4.2): the one way an answer's head is merged onto
 * main, a decider's ask files are composed onto it, a checked tree lands on
 * canonical `main` as a platform commit, and the config folder is read at a
 * landed commit. The Lander is trusted and runs no project code.
 *
 * Three additions to the spec's port (212): `land`'s `rebuild`, since `merge`
 * and `land` run in separate calls (the Answer Workflow's steps), so a
 * stateless adapter rebuilds the tree it lands; `land`'s `verdict`, the note
 * written after main moves; and `compose`, for running an ask's check red
 * first before the ask opens (spec §5 step 3).
 *
 * Adapters: `/memory` (scripted, for tests) and `/isogit` (isomorphic-git over
 * `RepoHost`, the fallback until the container Lander in `apps/sandbox`
 * passes, spec D6).
 */
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

/**
 * The mirror of canonical `main` (ADR 0005, spec D22): it moves only after
 * `main` did, in its own push, and only to the commit `main` points at.
 */
export const landedRef = RefName.make(`${Brand.refsPrefix}landed`);

/**
 * Where a composed commit waits, in the canonical repo, for a Checker to
 * fetch it by id. It is never `main`.
 */
export const composeRef = (tree: TreeSha) =>
  RefName.make(`${Brand.refsPrefix}compose/${tree}`);

/** An answer's head to merge onto canonical `main`. */
export interface MergeJob {
  /** The canonical repo. */
  readonly repo: RepoName;
  /** Where canonical `main` stood when the merge was asked for. */
  readonly main: LandedSha;
  /** The commit the answer was made on. */
  readonly base: CommitSha;
  readonly head: CommitSha;
  /** The claim's fork, which holds the answer's commits. */
  readonly fork: RepoName;
}

/** An answer merged onto main: the tree to check, and what the answer changed. */
export interface Merged {
  readonly tree: TreeSha;
  /** The answer's changes against its base, not main's. */
  readonly changes: readonly Change[];
}

/** One file a decider adds at its path, such as an ask file or its check. */
export interface ComposedFile {
  readonly path: RepoPath;
  readonly content: string;
}

/**
 * How a stateless adapter rebuilds the tree it lands: an answer's merge,
 * a decider's files composed onto main, or an existing commit's tree (a
 * revert). The rebuilt tree must be the job's `tree`.
 */
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

/** A checked tree to land on canonical `main` as a platform commit. */
export interface LandJob {
  readonly repo: RepoName;
  /** The `main` the tree was made and checked on: the push's compare-and-swap. */
  readonly main: LandedSha;
  readonly tree: TreeSha;
  /** The accountable person: the commit's author. The platform commits it. */
  readonly author: Handle;
  /**
   * The whole message, trailers included (`formatLanding`), with the
   * `Request-Id` trailer that makes a second land of the same request find
   * the first one's commit.
   */
  readonly message: string;
  readonly requestId: RequestId;
  readonly rebuild: Rebuild;
  /** The note written on the new commit once `main` has moved. */
  readonly verdict: Option.Option<Verdict>;
}

/** Bookkeeping written after `main` moved, each in its own push (S1 #6). */
export type Bookkeeping = "mirror" | "notes";

/**
 * A landing: the new tip of `main`, and the bookkeeping that did not get
 * written. A pending item never fails the landing; the service queues it in
 * the outbox and lands it again later.
 */
export interface Landed {
  readonly sha: LandedSha;
  readonly pending: readonly Bookkeeping[];
}

/** A decider's files to compose onto canonical `main`, so an ask's check can run red first. */
export interface ComposeJob {
  readonly repo: RepoName;
  readonly main: LandedSha;
  readonly files: Array.NonEmptyReadonlyArray<ComposedFile>;
}

/** Main with the files added: its tree, and the commit a Checker fetches it by. */
export interface Composed {
  readonly tree: TreeSha;
  /** On `composeRef(tree)` in the canonical repo; its parent is `main`. */
  readonly commit: CommitSha;
}

/** The config folder to read at one landed commit. */
export interface BundleJob {
  readonly repo: RepoName;
  readonly at: LandedSha;
}

export class Lander extends Context.Service<
  Lander,
  {
    /**
     * The answer's head merged three ways onto `main` (its base the merge
     * base), or `StaleBase` with the paths that conflict. An adapter whose
     * Checker fetches the tree keeps it where the Checker reaches: the
     * sandbox Lander pushes a commit of it to the fork's
     * `${Brand.refsPrefix}merge/<tree>` (W3 304 #1).
     */
    readonly merge: (
      job: MergeJob
    ) => Effect.Effect<Merged, StaleBase | VerifierBlocked>;
    /**
     * One commit on canonical `main` whose parent is `main` and whose tree is
     * `tree`, pushed with a non-force compare-and-swap: if `main` moved, the
     * land is `StaleBase`, never a force push. Then, each in its own push,
     * the mirror ref and the verdict note. A second land of the same request
     * returns the first one's commit.
     */
    readonly land: (
      job: LandJob
    ) => Effect.Effect<Landed, StaleBase | RepoBusy | VerifierBlocked>;
    /** `main` with the files added, pushed to `composeRef(tree)`; `main` never moves. */
    readonly compose: (
      job: ComposeJob
    ) => Effect.Effect<Composed, VerifierBlocked>;
    /**
     * Every file under the config folder at `at`, for the rules evaluator.
     * No folder gives no modules: the project runs on the defaults.
     */
    readonly bundleRules: (
      job: BundleJob
    ) => Effect.Effect<ConfigBundle, VerifierBlocked>;
  }
>()("project/Lander") {}
