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

export interface Change {
  readonly path: RepoPath;
  readonly status: "added" | "modified" | "deleted";
  readonly before?: BlobSha;
  readonly after?: BlobSha;
}

export interface AddedLine {
  readonly line: number;
  readonly text: string;
}

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

export const PushTarget = Data.taggedEnum<PushTarget>();

export interface PushFacts {
  readonly policy: Policy;
  readonly ask: Option.Option<Ask>;
  readonly claim: Option.Option<ClaimView>;
  readonly pusher: Principal;
  readonly target: PushTarget;
  readonly ref: RefNameText;
  readonly base: CommitSha;
  readonly head: CommitSha;
  readonly landed: LandedSha;
  readonly changes: readonly Change[];
  readonly addedLines: ReadonlyMap<RepoPath, readonly AddedLine[]>;
  readonly scriptsChanged: boolean;
  readonly layerPaths: ReadonlySet<RepoPath>;
  /**
   * Whether the pusher reads the layers `layerPaths` holds. Only a
   * reader hears which of their paths collide with a layer; anyone else
   * hears every path they wrote, so the refusal is no oracle. It vouches for
   * every layer in the set: true only when the pusher reads all of them, so
   * reading one layer never names another's paths. Absent, they read none.
   */
  readonly canReadLayers?: boolean;
  readonly claimsHeld: number;
  /** Only when the push opens the ask are its own file and check file the push's to write. */
  readonly opensAsk: boolean;
  readonly ratchetBaselines?: ReadonlyMap<RatchetName, number>;
  /**
   * The lines a push removes, by their 1-based number in the old file, so a
   * removed escape offsets an added one. Absent, a push removes none, which
   * only errs toward asking a maintainer.
   */
  readonly removedLines?: ReadonlyMap<RepoPath, readonly AddedLine[]>;
  /**
   * Each territory's count of reasoned escapes on main, by its escape
   * ratchet, when the caller keeps it apart from the baseline: a maintainer's
   * accepted `Waiver` raises the baseline before the answer lands, so the
   * answer, checked again, is within it. Absent, the baseline stands for it.
   */
  readonly escapeCounts?: ReadonlyMap<RatchetName, number>;
}
