// Nothing here names a layer's paths, a check, or a salt: the port returns
// roots, area bits and public ledger entries only.
import { HeldBackResult } from "@repo/protocol/domain/answer";
import type { ClaimView } from "@repo/protocol/domain/claim";
import { AtLeastOne } from "@repo/protocol/domain/common";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Policy } from "@repo/protocol/domain/policy";
import { RunBlock } from "@repo/protocol/domain/run";
import type { Ledger } from "@repo/protocol/domain/visibility";
import {
  AreaName,
  CommitSha,
  LandedSha,
  LayerName,
  RepoPath,
  SuiteRoot,
} from "@repo/protocol/ids";
import type { AskId, Handle, ProjectName, RequestId } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import type { Principal } from "@repo/protocol/principal";
import type { AttemptsExhausted, HeldBackFailed } from "@repo/protocol/refusal";
import { Context, Effect, Layer, Option, Schema } from "effect";
import type { DateTime } from "effect";

import type { ProjectSnapshot, ProjectWrites } from "./project-store.ts";
import type { PinnedSuite } from "./project-store/rows.ts";

/** The id keys its outbox row, so planning it twice runs it once. */
export const VisibilityEffect = Schema.Struct({
  body: Schema.Json,
  id: Schema.NonEmptyString,
});

export type VisibilityEffect = typeof VisibilityEffect.Type;

export interface VisibilityPlan {
  readonly effects: readonly VisibilityEffect[];
  readonly writes: ProjectWrites;
}

export const noPlan: VisibilityPlan = { effects: [], writes: {} };

export const LayerAccess = Schema.Literals(["none", "read", "write"]);

export type LayerAccess = typeof LayerAccess.Type;

/** The layer's files are read by the platform: no layer token or route ever reaches the sandbox. */
export const HeldBackJob = Schema.Struct({
  areas: Schema.Array(AreaName),
  at: CommitSha,
  files: Schema.Array(
    Schema.Struct({
      area: AreaName,
      content: Schema.Uint8Array,
      path: RepoPath,
    })
  ),
  runs: Schema.Array(
    Schema.Struct({
      area: AreaName,
      command: Schema.NonEmptyString,
      path: RepoPath,
    })
  ),
  suite: SuiteRoot,
});

export type HeldBackJob = typeof HeldBackJob.Type;

export interface HeldBackJudgement {
  readonly refusals: readonly (HeldBackFailed | AttemptsExhausted)[];
  readonly trailer: Option.Option<string>;
  readonly writes: ProjectWrites;
}

const unjudged: HeldBackJudgement = {
  refusals: [],
  trailer: Option.none(),
  writes: {},
};

export const AdmissionRun = Schema.TaggedUnion({
  OnKnownBad: { area: AreaName, job: HeldBackJob, tree: CommitSha },
  OnMain: { area: AreaName, attempt: Schema.Int, job: HeldBackJob },
});

export type AdmissionRun = typeof AdmissionRun.Type;

export const AdmissionPlan = Schema.Struct({
  admit: Schema.Struct({
    greenOnMainRuns: AtLeastOne,
    redOnKnownBadAtLeast: AtLeastOne,
  }),
  head: CommitSha,
  layer: LayerName,
  main: LandedSha,
  run: RunBlock,
  runs: Schema.Array(AdmissionRun),
});

export type AdmissionPlan = typeof AdmissionPlan.Type;

export const AdmissionReport = Schema.Struct({
  head: CommitSha,
  layer: LayerName,
  results: Schema.Array(
    Schema.Struct({
      areas: Schema.Array(HeldBackResult),
      run: AdmissionRun,
    })
  ),
});

export type AdmissionReport = typeof AdmissionReport.Type;

export const LayerFacts = Schema.Struct({
  /** Whether the pusher reads every layer the paths come from: only then does a refusal name which paths collide. */
  canRead: Schema.Boolean,
  layerPaths: Schema.Array(RepoPath),
});

export type LayerFacts = typeof LayerFacts.Type;

export interface PinnedClaim {
  readonly ask: AskId;
  readonly claimant: Handle;
  readonly pinned: PinnedSuite;
}

export interface VisibilityPort {
  readonly onPolicy: (
    input: {
      readonly after: Policy;
      readonly before: Option.Option<Policy>;
      readonly landings: readonly LandingView[];
      readonly now: DateTime.Utc;
    },
    snapshot: ProjectSnapshot
  ) => Effect.Effect<VisibilityPlan>;
  readonly pinSuite: (
    claim: { readonly ask: AskId; readonly claimant: Handle },
    snapshot: ProjectSnapshot
  ) => Option.Option<PinnedSuite>;
  readonly layerPaths: (
    snapshot: ProjectSnapshot
  ) => Effect.Effect<ReadonlySet<RepoPath>>;
  readonly readableLayers: (
    who: Principal,
    snapshot: ProjectSnapshot
  ) => ReadonlySet<LayerName>;
  readonly access: (
    who: Principal,
    layer: LayerName,
    snapshot: ProjectSnapshot
  ) => Option.Option<LayerAccess>;
  readonly heldBackJob: (
    claim: PinnedClaim,
    snapshot: ProjectSnapshot
  ) => Effect.Effect<Option.Option<HeldBackJob>>;
  readonly judgeHeldBack: (
    input: PinnedClaim & {
      readonly now: DateTime.Utc;
      readonly requestId: RequestId;
      readonly results: readonly HeldBackResult[];
    },
    snapshot: ProjectSnapshot
  ) => HeldBackJudgement;
  readonly onLayerPush: (
    input: {
      readonly head: CommitSha;
      readonly layer: LayerName;
      readonly now: DateTime.Utc;
      readonly pusher: Handle;
    },
    snapshot: ProjectSnapshot
  ) => Effect.Effect<VisibilityPlan>;
  readonly admissionPlan: (
    input: { readonly head: CommitSha; readonly layer: LayerName },
    snapshot: ProjectSnapshot
  ) => Effect.Effect<Option.Option<AdmissionPlan>>;
  readonly onAdmission: (
    input: AdmissionReport & { readonly now: DateTime.Utc },
    snapshot: ProjectSnapshot
  ) => Effect.Effect<VisibilityPlan>;
  readonly recordRead: (input: {
    readonly at: DateTime.Utc;
    readonly handle: Handle;
    readonly layer: LayerName;
    readonly sha: Option.Option<CommitSha>;
  }) => ProjectWrites;
  readonly ledger: (project: ProjectName, snapshot: ProjectSnapshot) => Ledger;
  readonly standing: (snapshot: ProjectSnapshot) => {
    readonly posture: Posture;
    readonly until: Option.Option<DateTime.Utc>;
  };
  readonly settle: (effect: VisibilityEffect) => Effect.Effect<boolean>;
}

export const noVisibility: VisibilityPort = {
  access: () => Option.none(),
  admissionPlan: () => Effect.succeedNone,
  heldBackJob: () => Effect.succeedNone,
  judgeHeldBack: () => unjudged,
  layerPaths: () => Effect.succeed(new Set()),
  ledger: (project) => ({
    entries: [],
    layers: [],
    posture: "open",
    postureLabel: "Open",
    project,
  }),
  onAdmission: () => Effect.succeed(noPlan),
  onLayerPush: () => Effect.succeed(noPlan),
  onPolicy: () => Effect.succeed(noPlan),
  pinSuite: () => Option.none(),
  readableLayers: () => new Set(),
  recordRead: () => ({}),
  settle: () => Effect.succeed(true),
  standing: () => ({ posture: "open", until: Option.none() }),
};

export const ProjectVisibility = Context.Reference<VisibilityPort>(
  "project/ProjectVisibility",
  { defaultValue: () => noVisibility }
);

export const NoVisibility: Layer.Layer<never> = Layer.succeed(
  ProjectVisibility,
  noVisibility
);

const decodePolicy = Schema.decodeUnknownOption(Schema.toCodecJson(Policy));

export const policyIn = (snapshot: ProjectSnapshot): Option.Option<Policy> =>
  Option.flatMap(snapshot.project, (row) =>
    row.policy === undefined ? Option.none() : decodePolicy(row.policy)
  );

export const suiteOf = (
  pinned: Option.Option<PinnedSuite>
): Pick<ClaimView, "suite"> =>
  Option.match(pinned, {
    onNone: () => ({}),
    onSome: ({ suite }) => ({ suite }),
  });
