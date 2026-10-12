import { Remote } from "@repo/checks/check-runner/wire";
import { Verdict } from "@repo/protocol/domain/answer";
import {
  CommitSha,
  Handle,
  LandedSha,
  RepoName,
  RepoPath,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import { RepoBusy, StaleBase, VerifierBlocked } from "@repo/protocol/refusal";
import { ConfigBundle } from "@repo/rules/rules-evaluator";
import { Schema } from "effect";

import type {
  BundleJob as BundleJobArgs,
  ComposeJob as ComposeJobArgs,
  Composed as ComposedResult,
  LandJob as LandJobArgs,
  Landed as LandedResult,
  Merged as MergedResult,
  MergeJob as MergeJobArgs,
} from "../lander.ts";
import { Change } from "../landing.ts";

export { Remote } from "@repo/checks/check-runner/wire";

export { ConfigBundle } from "@repo/rules/rules-evaluator";

export const ComposedFile = Schema.Struct({
  content: Schema.String,
  path: RepoPath,
});

export const MergeJob = Schema.Struct({
  base: CommitSha,
  fork: RepoName,
  head: CommitSha,
  main: LandedSha,
  repo: RepoName,
}) satisfies Schema.Codec<MergeJobArgs, unknown, unknown, unknown>;

export const Merged = Schema.Struct({
  changes: Schema.Array(Change),
  tree: TreeSha,
}) satisfies Schema.Codec<MergedResult, unknown, unknown, unknown>;

export const Rebuild = Schema.TaggedUnion({
  Compose: { files: Schema.NonEmptyArray(ComposedFile) },
  Existing: { commit: CommitSha },
  Merge: { base: CommitSha, fork: RepoName, head: CommitSha },
});

export const LandJob = Schema.Struct({
  author: Handle,
  main: LandedSha,
  message: Schema.String,
  rebuild: Rebuild,
  repo: RepoName,
  requestId: RequestId,
  tree: TreeSha,
  verdict: Schema.OptionFromOptionalKey(Verdict),
}) satisfies Schema.Codec<LandJobArgs, unknown, unknown, unknown>;

export const Landed = Schema.Struct({
  pending: Schema.Array(Schema.Literals(["mirror", "notes"])),
  sha: LandedSha,
}) satisfies Schema.Codec<LandedResult, unknown, unknown, unknown>;

export const ComposeJob = Schema.Struct({
  files: Schema.NonEmptyArray(ComposedFile),
  main: LandedSha,
  repo: RepoName,
}) satisfies Schema.Codec<ComposeJobArgs, unknown, unknown, unknown>;

export const Composed = Schema.Struct({
  commit: CommitSha,
  tree: TreeSha,
}) satisfies Schema.Codec<ComposedResult, unknown, unknown, unknown>;

export const BundleJob = Schema.Struct({
  at: LandedSha,
  repo: RepoName,
}) satisfies Schema.Codec<BundleJobArgs, unknown, unknown, unknown>;

export const MergeWire = Schema.Struct({
  fork: Remote,
  job: MergeJob,
  main: Remote,
});

/** The write token on canonical goes only to the trusted Lander, never to a Checker. */
export const LandWire = Schema.Struct({
  fork: Schema.optionalKey(Remote),
  job: LandJob,
  main: Remote,
});

/** A compose: a write token on canonical, used only for a compose ref, never `main`. */
export const ComposeWire = Schema.Struct({ job: ComposeJob, main: Remote });

export const BundleWire = Schema.Struct({ job: BundleJob, main: Remote });

export const MergeExit = Schema.toCodecJson(
  Schema.Exit(
    Merged,
    Schema.Union([StaleBase, VerifierBlocked]),
    Schema.Defect()
  )
);

export const LandExit = Schema.toCodecJson(
  Schema.Exit(
    Landed,
    Schema.Union([StaleBase, RepoBusy, VerifierBlocked]),
    Schema.Defect()
  )
);

export const ComposeExit = Schema.toCodecJson(
  Schema.Exit(Composed, VerifierBlocked, Schema.Defect())
);

export const BundleExit = Schema.toCodecJson(
  Schema.Exit(ConfigBundle, VerifierBlocked, Schema.Defect())
);
