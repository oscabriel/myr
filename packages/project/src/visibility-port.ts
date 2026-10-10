/**
 * Typed visibility's neutral port: everything the project service
 * asks of layers, held-back checks, admission and the ledger, with a
 * default that is a project without any of it. The visibility cartridge
 * (`./visibility/**`, `@repo/visibility`, and the platform's
 * `apps/platform/src/visibility/**`) plugs in by providing this port, so
 * removing the cartridge is a deletion: the default answers Open, no
 * layers, nothing held back, an empty ledger.
 *
 * The service hydrates, transitions, persists and settles (ADR 0012); the
 * port stays inside that loop. Each method reads the project as one call
 * has it (`snapshot`: its rows with the call's own writes so far on top),
 * and every change comes back as a plan the service commits with its own
 * rows: `writes` in the same commit, `effects` kept in the outbox and
 * settled after it through `settle`, retried by the alarm until done.
 *
 * Nothing here names a layer's paths, a check, or a salt: the port
 * returns roots, area bits and public ledger entries only.
 */
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

/**
 * A side effect a plan asks for, opaque to the service: the port that
 * planned it settles it (`settle`), after the commit that recorded it. The
 * id keys its outbox row, so planning it twice runs it once.
 */
export const VisibilityEffect = Schema.Struct({
  body: Schema.Json,
  id: Schema.NonEmptyString,
});

export type VisibilityEffect = typeof VisibilityEffect.Type;

/** What a port asks the service to write in the call's commit, and to settle after it. */
export interface VisibilityPlan {
  readonly effects: readonly VisibilityEffect[];
  readonly writes: ProjectWrites;
}

/** A plan that changes nothing. */
export const noPlan: VisibilityPlan = { effects: [], writes: {} };

/** How far a person may reach into a layer: clone it, push to it, or neither. */
export const LayerAccess = Schema.Literals(["none", "read", "write"]);

export type LayerAccess = typeof LayerAccess.Type;

/**
 * A sealed suite's run, as the platform gives it to the Checker: the
 * layer's files under the sealed areas at the pinned commit, read by the
 * platform (no layer token or route ever reaches the sandbox),
 * and one run per sealed check, the run block's `test` with its
 * `{path}` filled. It crosses the Project DO's boundary, so it is a schema.
 */
export const HeldBackJob = Schema.Struct({
  areas: Schema.Array(AreaName),
  /** The layer commit the suite was pinned at. */
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

/**
 * What one held-back run of an answer came to: the refusals it earns (an
 * area that failed, or an area out of attempts), the `Held-back:` trailer's
 * value when every area passed (without its key, as `formatLanding` takes
 * it), and the rows that count the attempt.
 */
export interface HeldBackJudgement {
  readonly refusals: readonly (HeldBackFailed | AttemptsExhausted)[];
  readonly trailer: Option.Option<string>;
  readonly writes: ProjectWrites;
}

/** A judgement that refuses nothing, adds no trailer and counts nothing. */
const unjudged: HeldBackJudgement = {
  refusals: [],
  trailer: Option.none(),
  writes: {},
};

/**
 * One admission run of a layer push's sealed checks: an area's
 * checks on main (green every time, `attempt` of the policy's count), or on
 * a known-bad tree (red at least once).
 */
export const AdmissionRun = Schema.TaggedUnion({
  OnKnownBad: { area: AreaName, job: HeldBackJob, tree: CommitSha },
  OnMain: { area: AreaName, attempt: Schema.Int, job: HeldBackJob },
});

export type AdmissionRun = typeof AdmissionRun.Type;

/**
 * The runs that admit a layer push, against the main they run on: what
 * admits an area (the policy's counts), and the run block each job runs
 * its checks by.
 */
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

/** What an admission's runs came to, as the `Answer` Workflow reports them: each run with its area bits. */
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

/** What the gate's stage 1 takes from visibility for one pusher (`ProjectApi.layerFacts`). */
export const LayerFacts = Schema.Struct({
  /** Whether the pusher reads every layer the paths come from: only then does a refusal name which paths collide. */
  canRead: Schema.Boolean,
  /** Every path in any layer's path set: none enters a public tree. */
  layerPaths: Schema.Array(RepoPath),
});

export type LayerFacts = typeof LayerFacts.Type;

/** A claim as the port sees it: whose, on which ask, and the suite it was pinned to. */
export interface PinnedClaim {
  readonly ask: AskId;
  readonly claimant: Handle;
  readonly pinned: PinnedSuite;
}

/**
 * Typed visibility as the project service reaches it. `snapshot` is always
 * the project as the call has it so far.
 */
export interface VisibilityPort {
  /**
   * After a call moved the landed SHA with a policy read there: provision
   * each declared layer's repo, append `LayerDeclared`, open a
   * `PostureChange` decision for a narrowing. `landings` are the call's
   * own, oldest first.
   */
  readonly onPolicy: (
    input: {
      readonly after: Policy;
      readonly before: Option.Option<Policy>;
      readonly landings: readonly LandingView[];
      readonly now: DateTime.Utc;
    },
    snapshot: ProjectSnapshot
  ) => Effect.Effect<VisibilityPlan>;
  /** The held-back suite a claim opening now is judged by, if one is sealed. */
  readonly pinSuite: (
    claim: { readonly ask: AskId; readonly claimant: Handle },
    snapshot: ProjectSnapshot
  ) => Option.Option<PinnedSuite>;
  /** Every path in any layer's path set, for stage 1's `PrivatePathInPublicTree`. */
  readonly layerPaths: (
    snapshot: ProjectSnapshot
  ) => Effect.Effect<ReadonlySet<RepoPath>>;
  /** The layers `who` may read: the write-down guard runs only for these. */
  readonly readableLayers: (
    who: Principal,
    snapshot: ProjectSnapshot
  ) => ReadonlySet<LayerName>;
  /** How far `who` may reach into `layer` (its readers and writers); none for a layer the project does not declare. */
  readonly access: (
    who: Principal,
    layer: LayerName,
    snapshot: ProjectSnapshot
  ) => Option.Option<LayerAccess>;
  /** The run of the suite a claim was pinned to, for an answer on it; none when nothing is sealed. */
  readonly heldBackJob: (
    claim: PinnedClaim,
    snapshot: ProjectSnapshot
  ) => Effect.Effect<Option.Option<HeldBackJob>>;
  /** One held-back run of an answer, judged: `HeldBackFailed` or `AttemptsExhausted`, or the trailer. */
  readonly judgeHeldBack: (
    input: PinnedClaim & {
      readonly now: DateTime.Utc;
      readonly requestId: RequestId;
      readonly results: readonly HeldBackResult[];
    },
    snapshot: ProjectSnapshot
  ) => HeldBackJudgement;
  /** A push to a layer's repo: its proposed head, admitted at once or through admission. */
  readonly onLayerPush: (
    input: {
      readonly head: CommitSha;
      readonly layer: LayerName;
      readonly now: DateTime.Utc;
      readonly pusher: Handle;
    },
    snapshot: ProjectSnapshot
  ) => Effect.Effect<VisibilityPlan>;
  /** The runs that would admit a layer's pushed head; none when nothing waits on admission. */
  readonly admissionPlan: (
    input: { readonly head: CommitSha; readonly layer: LayerName },
    snapshot: ProjectSnapshot
  ) => Effect.Effect<Option.Option<AdmissionPlan>>;
  /** An admission's results, judged: the layer's landed SHA moves (under a fresh commitment), or stays. */
  readonly onAdmission: (
    input: AdmissionReport & { readonly now: DateTime.Utc },
    snapshot: ProjectSnapshot
  ) => Effect.Effect<VisibilityPlan>;
  /** A read of a layer through the gateway, for the read log. */
  readonly recordRead: (input: {
    readonly at: DateTime.Utc;
    readonly handle: Handle;
    readonly layer: LayerName;
    readonly sha: Option.Option<CommitSha>;
  }) => ProjectWrites;
  /** The public ledger. */
  readonly ledger: (project: ProjectName, snapshot: ProjectSnapshot) => Ledger;
  /**
   * The posture the ledger shows now, and the next instant it moves by the
   * clock alone (an accepted narrowing whose notice still runs), if any:
   * what a list keeps a project's posture by (`standing-posture.ts`).
   */
  readonly standing: (snapshot: ProjectSnapshot) => {
    readonly posture: Posture;
    readonly until: Option.Option<DateTime.Utc>;
  };
  /** Runs one effect a plan asked for: true once it is done, false to try again later. */
  readonly settle: (effect: VisibilityEffect) => Effect.Effect<boolean>;
}

/** A project without typed visibility: Open, no layers, nothing held back, an empty ledger. */
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

/**
 * How a host gives the project service typed visibility. The default is
 * `noVisibility`, so a host that provides nothing (the core composition,
 * every test world) runs the platform without it.
 */
export const ProjectVisibility = Context.Reference<VisibilityPort>(
  "project/ProjectVisibility",
  { defaultValue: () => noVisibility }
);

/** The default, said out loud: a project without typed visibility. */
export const NoVisibility: Layer.Layer<never> = Layer.succeed(
  ProjectVisibility,
  noVisibility
);

const decodePolicy = Schema.decodeUnknownOption(Schema.toCodecJson(Policy));

/** The policy a snapshot's project row holds, decoded: what a port reads its rules from. */
export const policyIn = (snapshot: ProjectSnapshot): Option.Option<Policy> =>
  Option.flatMap(snapshot.project, (row) =>
    row.policy === undefined ? Option.none() : decodePolicy(row.policy)
  );

/** The suite a claim view shows: its pinned root. */
export const suiteOf = (
  pinned: Option.Option<PinnedSuite>
): Pick<ClaimView, "suite"> =>
  Option.match(pinned, {
    onNone: () => ({}),
    onSome: ({ suite }) => ({ suite }),
  });
