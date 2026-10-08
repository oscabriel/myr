/**
 * What the gate knows about one push: the facts its stages decide over. The
 * gate never reads a repo or computes a diff; its callers (the project
 * service, the CLI's local check) gather these and hand them in.
 */
import type { Ask } from "@repo/protocol/domain/ask";
import type { ClaimView } from "@repo/protocol/domain/claim";
import type { RefNameText } from "@repo/protocol/domain/common";
import type { Policy } from "@repo/protocol/domain/policy";
import type {
  AskId,
  BlobSha,
  CommitSha,
  Handle,
  LandedSha,
  LayerName,
  ProjectName,
  RatchetName,
  RepoPath,
} from "@repo/protocol/ids";
import type { Principal } from "@repo/protocol/principal";
import { Data } from "effect";
import type { Option } from "effect";

/** One path an answer changes, with its blob before and after. */
export interface Change {
  readonly path: RepoPath;
  readonly status: "added" | "modified" | "deleted";
  readonly before?: BlobSha;
  readonly after?: BlobSha;
}

/** One line an answer adds to a file, by its 1-based number in the new file. */
export interface AddedLine {
  readonly line: number;
  readonly text: string;
}

/**
 * Where a push goes, read from the repo's name: the canonical
 * repo `<project>`, a claim's fork `<project>--<ask>--<handle>`, a person's
 * working fork `<project>--me--<handle>`, or a layer's repo
 * `<project>--<layer>`.
 */
export type PushTarget = Data.TaggedEnum<{
  Canonical: { readonly project: ProjectName };
  ClaimFork: {
    readonly project: ProjectName;
    readonly ask: AskId;
    readonly claimant: Handle;
  };
  Layer: { readonly project: ProjectName; readonly layer: LayerName };
  WorkingFork: { readonly project: ProjectName; readonly owner: Handle };
}>;

/** Constructors and matchers for `PushTarget`. */
export const PushTarget = Data.taggedEnum<PushTarget>();

/** Everything the gate's stages decide one push over. */
export interface PushFacts {
  /** The policy at the landed SHA: the only place rules are read from. */
  readonly policy: Policy;
  /** The ask the push answers (or opens), if one is open. */
  readonly ask: Option.Option<Ask>;
  /** The claim on that ask, whoever holds it. */
  readonly claim: Option.Option<ClaimView>;
  readonly pusher: Principal;
  readonly target: PushTarget;
  readonly ref: RefNameText;
  readonly base: CommitSha;
  readonly head: CommitSha;
  readonly landed: LandedSha;
  readonly changes: readonly Change[];
  readonly addedLines: ReadonlyMap<RepoPath, readonly AddedLine[]>;
  /** Whether `package.json#/scripts` differs; the caller compares the two JSON pointers. */
  readonly scriptsChanged: boolean;
  /**
   * Paths that belong to a layer, which no public tree may carry (empty without
   * the visibility cartridge): files, or folders whose every path is the
   * layer's.
   */
  readonly layerPaths: ReadonlySet<RepoPath>;
  /**
   * Whether the pusher reads the layers `layerPaths` holds. Only a
   * reader hears which of their paths collide with a layer; anyone else
   * hears every path they wrote, so the refusal is no oracle. It vouches for
   * every layer in the set: true only when the pusher reads all of them, so
   * reading one layer never names another's paths. Absent, they read none.
   */
  readonly canReadLayers?: boolean;
  /** How many live claims the pusher holds, for `CapReached`. */
  readonly claimsHeld: number;
  /**
   * Whether the push opens `ask` (a decider's `openAsk`) rather than answers
   * it. Only then are the ask's own file and check file the push's to write.
   */
  readonly opensAsk: boolean;
  /**
   * Each ratchet's baseline, from the project's `ratchets` rows: the most a
   * count may be. A territory's escape ratchet is named by `escapeRatchet`.
   * Absent, or with no row for a ratchet, the baseline is 0.
   */
  readonly ratchetBaselines?: ReadonlyMap<RatchetName, number>;
  /**
   * The lines a push removes, by their 1-based number in the old file, so a
   * removed escape offsets an added one. Absent, a push removes none, which
   * only errs toward asking a decider.
   */
  readonly removedLines?: ReadonlyMap<RepoPath, readonly AddedLine[]>;
  /**
   * Each territory's count of reasoned escapes on main, by its escape
   * ratchet, when the caller keeps it apart from the baseline: a decider's
   * accepted `Waiver` raises the baseline before the answer lands, so the
   * answer, checked again, is within it. Absent, the baseline stands for it.
   */
  readonly escapeCounts?: ReadonlyMap<RatchetName, number>;
}
