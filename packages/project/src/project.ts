import {
  BranchName,
  RefName,
  RepoHost,
  Revision,
} from "@repo/artifacts/repo-host";
import type {
  ObjectId,
  RepoNotFound,
  TreeEntry,
} from "@repo/artifacts/repo-host";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { Brand } from "@repo/brand";
import {
  CheckAt,
  CheckLane,
  CheckRunner,
  outputOf,
} from "@repo/checks/check-runner";
import type { CheckRun } from "@repo/checks/check-runner";
import { EvidenceStore, LogRef, logOfRef } from "@repo/checks/evidence-store";
import { findRunBlock } from "@repo/checks/finder";
import { judgeClosure } from "@repo/checks/judge";
import { checkVersion, commandFor } from "@repo/checks/kinds";
import { lintToZeroCount } from "@repo/checks/kinds/lint-to-zero";
import type { LintToZeroCheck } from "@repo/checks/kinds/lint-to-zero";
import {
  judgeRatchets,
  measure,
  WHOLE_PROJECT,
} from "@repo/checks/kinds/ratchet";
import type { RaiseRatchet, RatchetCount } from "@repo/checks/kinds/ratchet";
import { redFirstOfRuns } from "@repo/checks/red-first";
import { weaknessesOf } from "@repo/checks/weak-shapes";
import {
  escapeDecisions,
  escapeRatchet,
  explainedRaises,
  territoryOf,
} from "@repo/gate/escapes";
import type { Waiver } from "@repo/gate/escapes";
import { PushTarget } from "@repo/gate/facts";
import type { PushFacts } from "@repo/gate/facts";
import { pushStages, refusingStage, runGate } from "@repo/gate/gate";
import type { StageRefusal } from "@repo/gate/gate";
import { scan } from "@repo/gate/stages/shape";
import { verdictOf } from "@repo/gate/verdict";
import { answerBase } from "@repo/git/answer-base";
import { patchId } from "@repo/git/patch-id";
import { formatLanding } from "@repo/git/trailers";
import { HarnessAudit } from "@repo/protocol/audit";
import {
  Claim as ClaimContract,
  Credits,
  Decide,
  DraftAsk,
  EnvSchemaOf,
  EvidenceOf,
  Finish,
  FlagAsk,
  Fork,
  InitProject,
  Land,
  LandingOf,
  LedgerOf,
  ListAsks,
  OpenAsk,
  PolicyOf,
  ProposeAsk,
  Release,
  SetEnv,
  ShowAsk,
  ShowProposal,
  Status,
  SubmitAnswer,
  TodayOf,
  VerdictOf,
  Vouch,
} from "@repo/protocol/contracts";
import {
  AnswerReceipt,
  HeldBackResult,
  Verdict,
} from "@repo/protocol/domain/answer";
import type { AnswerView, LaneResult } from "@repo/protocol/domain/answer";
import type { Ask, AskListing } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import type { ClaimView } from "@repo/protocol/domain/claim";
import { ForkRef } from "@repo/protocol/domain/code";
import {
  AtLeastOne,
  ConfigFile,
  NoneOrMore,
  RefNameText,
} from "@repo/protocol/domain/common";
import type { Evidence } from "@repo/protocol/domain/common";
import type { AgentTrailer, Credit } from "@repo/protocol/domain/credit";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision } from "@repo/protocol/domain/decision";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { AskKind } from "@repo/protocol/domain/kind";
import { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { StageName } from "@repo/protocol/domain/outcome";
import type { ImportSource, PublicPolicy } from "@repo/protocol/domain/policy";
import { Policy } from "@repo/protocol/domain/policy";
import type { Proposal } from "@repo/protocol/domain/proposal";
import {
  AskId,
  CommitSha,
  EnvKey,
  Handle,
  LandedSha,
  LayerName,
  ProposalId,
  RepoName,
  RepoPath,
  RequestId,
  TreeSha,
  addressOfRepo,
  claimForkName,
  isSourceNamespace,
  keyOf,
  ownerOf,
  sameHandle,
  sourceNamespaceOf,
} from "@repo/protocol/ids";
import type { DecisionId, LaneName, ProjectName } from "@repo/protocol/ids";
import { Posture } from "@repo/protocol/posture";
import { Person, Principal } from "@repo/protocol/principal";
import {
  AskFull,
  DirectPush,
  ImportFailed,
  IncompleteBrief,
  NotClaimed,
  NotDecider,
  NotRedFirst,
  NotYourNamespace,
  ProjectExists,
  ProposalClosed,
  Refusal,
  StaleBase,
  TouchedJudge,
  UnknownAsk,
  UnknownCommit,
  UnknownProject,
  UnknownProposal,
  VerifierBlocked,
  WeakCheck,
} from "@repo/protocol/refusal";
import type {
  AskBlocked,
  CapReached,
  ClaimLapsed,
  Denounced,
  OutOfScope,
  PrivatePathInPublicTree,
  ReachedInternals,
  RepoBusy,
  Weakened,
  NotVouched,
} from "@repo/protocol/refusal";
import { Finishers } from "@repo/rules/finish";
import { RulesEvaluator, sdkVersion } from "@repo/rules/rules-evaluator";
import {
  Array,
  Cause,
  Context,
  DateTime,
  Effect,
  Layer,
  Match,
  Option,
  Order,
  Record,
  Ref,
  Result,
  Schema,
  Semaphore,
  Struct,
} from "effect";
import type { Data } from "effect";
import { init } from "isomorphic-git";

import { Alarms } from "./alarms.ts";
import {
  AnswerReport,
  AnswerRun,
  MeasuredCount,
  ReportedCommand,
  Steps,
} from "./answer-runs.ts";
import type { AnswerQueue, AnswerRuns, RunnableEffect } from "./answer-runs.ts";
import { isStep } from "./answer-runs/steps.ts";
import { openDecision } from "./attention/decisions.ts";
import { recordOf } from "./attention/record.ts";
import { capFor, capped, mayClaim, standing } from "./attention/vouch.ts";
import {
  ClaimCommand,
  ClaimEffect,
  ClaimState,
  toView,
  transition as claimTransition,
} from "./claim.ts";
import type { ClaimStep, Live } from "./claim.ts";
import {
  askIdOf,
  deciderDeadlines,
  deciders,
  decidersOn,
  decidesOn,
  envSchemaMethod,
  isDecider,
  nextDecisionId,
  pathsOf,
  strayDecision,
} from "./deciders.ts";
import type { DeciderApi, Opening } from "./deciders.ts";
import {
  DraftContextData,
  DraftResult,
  DraftRuns,
  EXCERPT_BYTES,
  Rehearsal,
} from "./draft-runs.ts";
import type { Diagnosis } from "./draft-runs.ts";
import { ProjectEnv } from "./env-port.ts";
import {
  askClosed,
  askOpened,
  judged,
  listingOf,
  numbered,
  ProjectEventInput,
} from "./events.ts";
import { evaluationFacts, pushFacts, targetOf } from "./facts.ts";
import type { MissingCommit } from "./facts.ts";
import {
  generatedFollowUp,
  generatedRequestId,
  ProjectGenerator,
} from "./generated.ts";
import { Lander, Rebuild } from "./lander.ts";
import type { ComposedFile } from "./lander.ts";
import {
  LandingCommand,
  LandingEffect,
  LandingState,
  outcomeOf,
  transition as landingTransition,
} from "./landing.ts";
import type { LandingQueue, PendingDecision, Request } from "./landing.ts";
import {
  lanePoints,
  MetricPoint,
  Metrics,
  millisBetween,
  refusedPoints,
} from "./metrics.ts";
import {
  callerCountOf,
  callersIn,
  callersRatchet,
  callersSpecs,
  familyClosed,
  remainingBlockers,
  sameCount,
  splitFamily,
} from "./migrate.ts";
import {
  isDue,
  measuredRow,
  outboxRow,
  OutboxBody,
  projectedRows,
  runOutbox,
  startRow,
} from "./outbox.ts";
import { ProjectStore } from "./project-store.ts";
import type { ProjectSnapshot, ProjectWrites } from "./project-store.ts";
import type {
  AnswerRow,
  AttemptRow,
  BudgetDayRow,
  ClaimRow,
  EnvValueRow,
  LayerRead,
  LayerRow,
  LedgerRow,
  OutboxRow,
  PinnedSuite,
  ProjectRow,
  PushEventRow,
  RatchetRow,
} from "./project-store/rows.ts";
import { Tables } from "./project-store/tables.ts";
import type { Table } from "./project-store/tables.ts";
import type { Projection } from "./projection.ts";
import { askToLand, holdsSlot, leave, queueOf, storedQueue } from "./queue.ts";
import { afterLanding, decideRaise } from "./ratchets.ts";
import type { RatchetBaseline } from "./ratchets.ts";
import {
  AdmissionPlan,
  AdmissionReport,
  HeldBackJob,
  LayerAccess,
  LayerFacts,
  ProjectVisibility,
} from "./visibility-port.ts";
import type { VisibilityPlan } from "./visibility-port.ts";

export type ProjectPorts =
  | Alarms
  | AnswerRuns
  | CheckRunner
  | Lander
  | ProjectStore
  | Projection
  | RepoHost
  | RulesEvaluator;

/** The gateway every repo's git URL starts with; never an Artifacts URL. */
export const GatewayUrl = Context.Reference<string>("project/GatewayUrl", {
  defaultValue: () => `https://${Brand.domain}`,
});

/** Injected from `@repo/checks` because `rules` may not import `checks`. */
export const FinishersFromChecks: Layer.Layer<Finishers> = Layer.succeed(
  Finishers,
  { findRunBlock, judgeClosure }
);

export const PushReport = Schema.Struct({
  after: CommitSha,
  /** Self-reported by the credential helper: audit metadata, never who pushed. */
  audit: Schema.optionalKey(HarnessAudit),
  before: Schema.Option(CommitSha),
  eventId: Schema.NonEmptyString,
  pusher: Principal,
  ref: Schema.NonEmptyString,
  repo: RepoName,
});

export type PushReport = typeof PushReport.Type;

export interface AskFile {
  readonly content: string;
  readonly path: RepoPath;
}

export const StandingNow = Schema.Struct({
  posture: Posture,
  seen: Schema.Int,
  until: Schema.optionalKey(Schema.DateTimeUtcFromString),
});

export type StandingNow = typeof StandingNow.Type;

export type SubmitRefusal =
  | NotClaimed
  | ClaimLapsed
  | StaleBase
  | RepoBusy
  | OutOfScope
  | TouchedJudge
  | Weakened
  | ReachedInternals
  | PrivatePathInPublicTree;

export interface ProjectApi extends AnswerQueue, DeciderApi {
  readonly listAsks: (
    caller: Principal
  ) => Effect.Effect<{ readonly asks: readonly AskListing[] }>;
  readonly showAsk: (
    caller: Principal,
    ask: AskId
  ) => Effect.Effect<{ readonly ask: Ask; readonly brief: string }, UnknownAsk>;
  readonly status: (caller: Person) => Effect.Effect<{
    readonly answers: readonly AnswerView[];
    readonly claims: readonly ClaimView[];
  }>;
  readonly verdict: (
    caller: Principal,
    input: { readonly ask: AskId; readonly head?: CommitSha }
  ) => Effect.Effect<{ readonly verdict?: Verdict }, UnknownAsk>;
  readonly landing: (
    caller: Principal,
    sha: CommitSha
  ) => Effect.Effect<{ readonly landing: LandingView }, UnknownCommit>;
  readonly head: () => Effect.Effect<{ readonly landed?: LandedSha }>;
  /** How many landings the platform has made on main, every one it keeps. */
  readonly landingCount: () => Effect.Effect<number>;
  readonly forks: () => Effect.Effect<readonly ForkRef[]>;
  readonly standing: () => Effect.Effect<StandingNow>;
  readonly policy: () => Effect.Effect<PolicyStatus>;
  readonly draftContext: (
    proposal: ProposalId,
    round: number
  ) => Effect.Effect<DraftContextData, UnknownProposal | ProposalClosed>;
  readonly rehearseOpen: (
    files: readonly ConfigFile[]
  ) => Effect.Effect<Rehearsal, VerifierBlocked | StaleBase>;
  readonly draftSettled: (
    proposal: ProposalId,
    round: number,
    result: DraftResult
  ) => Effect.Effect<void>;
  readonly evidence: (
    caller: Principal,
    ref: LogRef
  ) => Effect.Effect<
    {
      readonly lane: LaneName;
      readonly text: string;
      readonly truncated: boolean;
    },
    NotDecider | UnknownProject,
    EvidenceStore
  >;
  readonly events: (
    since: number,
    limit: number
  ) => Effect.Effect<
    readonly { readonly event: ProjectEvent; readonly seq: number }[]
  >;
  readonly firstPusher: () => Effect.Effect<Option.Option<Handle>>;
  readonly initProject: (
    caller: Person,
    input: {
      readonly import?: { readonly branch?: string; readonly url: string };
    }
  ) => Effect.Effect<
    {
      readonly landed?: LandedSha;
      readonly project: ProjectName;
      readonly remote: string;
    },
    ProjectExists | NotYourNamespace | ImportFailed
  >;
  readonly recordFirstPush: (
    caller: Person,
    head: CommitSha
  ) => Effect.Effect<{ readonly landed: LandedSha }, DirectPush>;
  readonly openAsk: (
    caller: Person,
    input: {
      readonly ask: AskId;
      readonly files: Array.NonEmptyReadonlyArray<AskFile>;
    }
  ) => Effect.Effect<
    { readonly ask: Ask; readonly landed: LandedSha },
    | NotDecider
    | NotRedFirst
    | WeakCheck
    | IncompleteBrief
    | TouchedJudge
    | VerifierBlocked
    | StaleBase
  >;
  readonly claim: (
    caller: Person,
    ask: AskId
  ) => Effect.Effect<
    { readonly claim: ClaimView },
    UnknownAsk | AskFull | AskBlocked | CapReached | NotVouched | Denounced
  >;
  readonly release: (
    caller: Person,
    ask: AskId
  ) => Effect.Effect<{ readonly released: boolean }, NotClaimed>;
  readonly recordPush: (input: PushReport) => Effect.Effect<readonly Refusal[]>;
  readonly submitAnswer: (
    caller: Person,
    input: {
      readonly ask: AskId;
      readonly base: CommitSha;
      readonly head: CommitSha;
      readonly requestId: RequestId;
    }
  ) => Effect.Effect<AnswerReceipt, SubmitRefusal>;
  readonly onAlarm: () => Effect.Effect<void>;
  readonly layerAccess: (
    caller: Principal,
    layer: LayerName
  ) => Effect.Effect<Option.Option<LayerAccess>>;
  readonly layerFacts: (caller: Principal) => Effect.Effect<LayerFacts>;
  readonly recordLayerPush: (
    caller: Person,
    input: { readonly head: CommitSha; readonly layer: LayerName }
  ) => Effect.Effect<void>;
  readonly recordLayerRead: (
    caller: Person,
    input: { readonly layer: LayerName; readonly sha?: CommitSha }
  ) => Effect.Effect<void>;
  readonly heldBackJob: (
    requestId: RequestId
  ) => Effect.Effect<Option.Option<HeldBackJob>>;
  readonly recordHeldBack: (
    requestId: RequestId,
    results: readonly HeldBackResult[]
  ) => Effect.Effect<readonly Refusal[]>;
  readonly admissionPlan: (input: {
    readonly head: CommitSha;
    readonly layer: LayerName;
  }) => Effect.Effect<Option.Option<AdmissionPlan>>;
  readonly recordAdmission: (input: AdmissionReport) => Effect.Effect<void>;
  readonly scanForValues: (
    input: { readonly text: string } | { readonly blob: Uint8Array }
  ) => Effect.Effect<Option.Option<EnvKey>>;
}

const MAX_DRAFT_PATHS = 50_000;

export type PolicyStatus = typeof PolicyOf.successSchema.Type;

export const MAX_LANDINGS = 100;

export interface MethodSchema {
  readonly args: readonly Schema.Top[];
  readonly error: Schema.Top;
  readonly success: Schema.Top & { readonly EncodingServices: never };
}

export const MethodSchemas = {
  [envSchemaMethod]: {
    args: [Principal],
    error: EnvSchemaOf.errorSchema,
    success: EnvSchemaOf.successSchema,
  },
  admissionPlan: {
    args: [Schema.Struct({ head: CommitSha, layer: LayerName })],
    error: Schema.Never,
    success: Schema.Option(AdmissionPlan),
  },
  advanceAnswer: {
    args: [RequestId, ReportedCommand, Schema.UndefinedOr(AnswerReport)],
    error: Schema.Never,
    success: Steps,
  },
  answer: {
    args: [RequestId],
    error: Schema.Never,
    success: Schema.Option(AnswerRun),
  },
  claim: {
    args: [Person, AskId],
    error: ClaimContract.errorSchema,
    success: ClaimContract.successSchema,
  },
  credits: {
    args: [Principal, Handle],
    error: Schema.Never,
    success: Credits.successSchema,
  },
  decide: {
    args: [Person, Decide.payloadSchema.mapFields(Struct.omit(["project"]))],
    error: Decide.errorSchema,
    success: Decide.successSchema,
  },
  draftAsk: {
    args: [Person, DraftAsk.payloadSchema.mapFields(Struct.omit(["project"]))],
    error: DraftAsk.errorSchema,
    success: DraftAsk.successSchema,
  },
  draftContext: {
    args: [ProposalId, AtLeastOne],
    error: Schema.Union([UnknownProposal, ProposalClosed]),
    success: DraftContextData,
  },
  draftSettled: {
    args: [ProposalId, AtLeastOne, DraftResult],
    error: Schema.Never,
    success: Schema.Void,
  },
  events: {
    args: [Schema.Int, Schema.Int],
    error: Schema.Never,
    success: Schema.Array(
      Schema.Struct({ event: ProjectEvent, seq: Schema.Int })
    ),
  },
  evidence: {
    args: [Principal, LogRef],
    error: EvidenceOf.errorSchema,
    success: EvidenceOf.successSchema,
  },
  finish: {
    args: [Person, Finish.payloadSchema.mapFields(Struct.omit(["project"]))],
    error: Finish.errorSchema,
    success: Finish.successSchema,
  },
  firstPusher: {
    args: [],
    error: Schema.Never,
    success: Schema.Option(Handle),
  },
  flagAsk: {
    args: [Person, FlagAsk.payloadSchema.mapFields(Struct.omit(["project"]))],
    error: FlagAsk.errorSchema,
    success: FlagAsk.successSchema,
  },
  fork: {
    args: [Person],
    error: Fork.errorSchema,
    success: Fork.successSchema,
  },
  forks: { args: [], error: Schema.Never, success: Schema.Array(ForkRef) },
  head: {
    args: [],
    error: Schema.Never,
    success: Schema.Struct({ landed: Schema.optionalKey(LandedSha) }),
  },
  heldBackJob: {
    args: [RequestId],
    error: Schema.Never,
    success: Schema.Option(HeldBackJob),
  },
  initProject: {
    args: [
      Person,
      Schema.Struct({ import: InitProject.payloadSchema.fields.import }),
    ],
    error: InitProject.errorSchema,
    success: InitProject.successSchema,
  },
  land: {
    args: [Person, Land.payloadSchema.mapFields(Struct.omit(["project"]))],
    error: Land.errorSchema,
    success: Land.successSchema,
  },
  landing: {
    args: [Principal, CommitSha],
    error: LandingOf.errorSchema,
    success: LandingOf.successSchema,
  },
  landingCount: { args: [], error: Schema.Never, success: NoneOrMore },
  landings: {
    args: [Schema.Array(CommitSha).check(Schema.isMaxLength(MAX_LANDINGS))],
    error: Schema.Never,
    success: Schema.Array(LandingView),
  },
  layerAccess: {
    args: [Principal, LayerName],
    error: Schema.Never,
    success: Schema.Option(LayerAccess),
  },
  layerFacts: {
    args: [Principal],
    error: Schema.Never,
    success: LayerFacts,
  },
  ledger: {
    args: [Principal],
    error: LedgerOf.errorSchema,
    success: LedgerOf.successSchema,
  },
  listAsks: {
    args: [Principal],
    error: ListAsks.errorSchema,
    success: ListAsks.successSchema,
  },
  onAlarm: { args: [], error: Schema.Never, success: Schema.Void },
  openAsk: {
    args: [
      Person,
      Schema.Struct({ ask: AskId, files: OpenAsk.payloadSchema.fields.files }),
    ],
    error: OpenAsk.errorSchema,
    success: OpenAsk.successSchema,
  },
  policy: {
    args: [],
    error: Schema.Never,
    success: PolicyOf.successSchema,
  },
  proposeAsk: {
    args: [
      Person,
      // The check reads only `draft`, `files` and `sealed`, which it keeps.
      ProposeAsk.payloadSchema.mapFields(Struct.omit(["project"]), {
        unsafePreserveChecks: true,
      }),
    ],
    error: ProposeAsk.errorSchema,
    success: ProposeAsk.successSchema,
  },
  recordAdmission: {
    args: [AdmissionReport],
    error: Schema.Never,
    success: Schema.Void,
  },
  recordFirstPush: {
    args: [Person, CommitSha],
    error: DirectPush,
    success: Schema.Struct({ landed: LandedSha }),
  },
  recordHeldBack: {
    args: [RequestId, Schema.Array(HeldBackResult)],
    error: Schema.Never,
    success: Schema.Array(Refusal),
  },
  recordLayerPush: {
    args: [Person, Schema.Struct({ head: CommitSha, layer: LayerName })],
    error: Schema.Never,
    success: Schema.Void,
  },
  recordLayerRead: {
    args: [
      Person,
      Schema.Struct({ layer: LayerName, sha: Schema.optionalKey(CommitSha) }),
    ],
    error: Schema.Never,
    success: Schema.Void,
  },
  recordPush: {
    args: [PushReport],
    error: Schema.Never,
    success: Schema.Array(Refusal),
  },
  rehearseOpen: {
    args: [Schema.Array(ConfigFile)],
    error: Schema.Union([VerifierBlocked, StaleBase]),
    success: Rehearsal,
  },
  release: {
    args: [Person, AskId],
    error: Release.errorSchema,
    success: Release.successSchema,
  },
  scanForValues: {
    args: [
      Schema.Union([
        Schema.Struct({ text: Schema.String }),
        Schema.Struct({ blob: Schema.Uint8Array }),
      ]),
    ],
    error: Schema.Never,
    success: Schema.Option(EnvKey),
  },
  setEnv: {
    args: [Person, SetEnv.payloadSchema.mapFields(Struct.omit(["project"]))],
    error: SetEnv.errorSchema,
    success: SetEnv.successSchema,
  },
  showAsk: {
    args: [Principal, AskId],
    error: ShowAsk.errorSchema,
    success: ShowAsk.successSchema,
  },
  showProposal: {
    args: [Principal, ProposalId],
    error: ShowProposal.errorSchema,
    success: ShowProposal.successSchema,
  },
  standing: {
    args: [],
    error: Schema.Never,
    success: StandingNow,
  },
  status: {
    args: [Person],
    error: Status.errorSchema,
    // The contract adds the caller's handle at the platform's edge; a project
    // answers with its own claims and answers only.
    success: Status.successSchema.mapFields(Struct.omit(["handle"])),
  },
  submitAnswer: {
    args: [
      Person,
      Schema.Struct({
        ask: AskId,
        base: CommitSha,
        head: CommitSha,
        requestId: RequestId,
      }),
    ],
    error: SubmitAnswer.errorSchema,
    success: SubmitAnswer.successSchema,
  },
  today: {
    args: [Person],
    error: TodayOf.errorSchema,
    success: TodayOf.successSchema,
  },
  verdict: {
    args: [
      Principal,
      Schema.Struct({ ask: AskId, head: Schema.optionalKey(CommitSha) }),
    ],
    error: VerdictOf.errorSchema,
    success: VerdictOf.successSchema,
  },
  vouch: {
    args: [Person, Vouch.payloadSchema.mapFields(Struct.omit(["project"]))],
    error: Vouch.errorSchema,
    success: Vouch.successSchema,
  },
} as const satisfies { readonly [M in keyof ProjectApi]: MethodSchema };

export const Measured = Schema.Struct({
  declared: Schema.Array(MeasuredCount),
  escapes: Schema.Array(MeasuredCount),
});

export type Measured = typeof Measured.Type;

export const HeldBackJudged = Schema.Struct({
  refusals: Schema.Array(Refusal),
  trailer: Schema.optionalKey(Schema.NonEmptyString),
  tree: TreeSha,
});

export type HeldBackJudged = typeof HeldBackJudged.Type;

export const AnswerRecord = Schema.Struct({
  heldBack: Schema.optionalKey(HeldBackJudged),
  landing: LandingState,
  measured: Schema.optionalKey(Measured),
  /** When the answer was queued: absent from an answer queued before it was kept. */
  queuedAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
  receipt: AnswerReceipt,
  verdict: Schema.optionalKey(Verdict),
  waived: Schema.optionalKey(Schema.Array(DecisionSubject.cases.Waiver)),
});

export type AnswerRecord = typeof AnswerRecord.Type;

const ClaimJson = Schema.toCodecJson(ClaimState);

const AnswerJson = Schema.toCodecJson(AnswerRecord);

const PolicyJson = Schema.toCodecJson(Policy);

const decodeClaim = Schema.decodeUnknownEffect(ClaimJson);

const encodeClaim = Schema.encodeEffect(ClaimJson);

const decodeAnswer = Schema.decodeUnknownEffect(AnswerJson);

const encodeAnswer = Schema.encodeEffect(AnswerJson);

const decodePolicy = Schema.decodeUnknownEffect(PolicyJson);

const encodePolicy = Schema.encodeEffect(PolicyJson);

const checked = <A, E, R>(
  schemas: MethodSchema,
  args: readonly unknown[],
  run: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.forEach(
    schemas.args,
    (schema, index) =>
      Effect.orDie(
        Schema.decodeUnknownEffect(Schema.toType(schema))(args[index])
      ),
    { discard: true }
  ).pipe(
    Effect.andThen(run),
    Effect.tap((value) =>
      Effect.orDie(Schema.encodeUnknownEffect(schemas.success)(value))
    )
  );

const publicPolicy = (policy: Policy): PublicPolicy =>
  Struct.omit(policy, ["asks", "functions", "visibility"]);

const listedFork = (claim: Live, state: ClaimView["state"]) =>
  Option.some<ForkRef>({
    ask: claim.ask,
    handle: claim.claimant,
    kind: "claim",
    repo: claim.fork,
    state,
  });

const forkOf = (state: ClaimState): Option.Option<ForkRef> =>
  ClaimState.match(state, {
    Answered: (claim) => listedFork(claim, "answered"),
    Lapsed: (claim) => listedFork(claim, "lapsed"),
    Live: (claim) => listedFork(claim, "live"),
    Open: () => Option.none(),
    Released: (claim) => listedFork(claim, "released"),
    Warned: (claim) => listedFork(claim, "warned"),
  });

const EVIDENCE_TAIL = 256 * 1024;

const startsCharacter = (byte: number) => byte < 0x80 || byte >= 0xc0;

/** The log's tail, where a failure prints, cut between UTF-8 characters. */
const tailOf = (log: string, limit = EVIDENCE_TAIL) => {
  const bytes = new TextEncoder().encode(log);

  if (bytes.length <= limit) {
    return { text: log, truncated: false };
  }

  const tail = bytes.subarray(bytes.length - limit);
  const from = tail.findIndex(startsCharacter);

  return {
    text: from === -1 ? "" : new TextDecoder().decode(tail.subarray(from)),
    truncated: true,
  };
};

const mainRef = RefName.make("refs/heads/main");

const HOUR = 3_600_000;

const defaultClaims: Policy["claims"] = {
  lapseAfterMs: 24 * HOUR,
  warnAfterMs: 2 * HOUR,
};

interface Claimed {
  readonly row: ClaimRow;
  readonly state: ClaimState;
}

interface Answered {
  readonly record: AnswerRecord;
  readonly row: AnswerRow;
}

interface Hydrated {
  readonly answers: readonly Answered[];
  readonly asks: ReadonlyMap<AskId, Ask>;
  readonly budgetDays: readonly BudgetDayRow[];
  readonly claims: readonly Claimed[];
  readonly decisions: readonly Decision[];
  readonly landings: readonly LandingView[];
  readonly lastSeq: number;
  readonly outbox: readonly OutboxRow[];
  readonly policy: Option.Option<Policy>;
  readonly project: Option.Option<ProjectRow>;
  readonly proposals: readonly Proposal[];
  readonly queue: LandingQueue;
  readonly ratchets: readonly RatchetRow[];
  readonly snapshot: ProjectSnapshot;
}

/** The project row and the queue sit in one-entry maps so the record itself never changes. */
interface Writes {
  readonly answers: Map<RequestId, AnswerRow>;
  readonly asks: Map<AskId, Ask>;
  readonly attempts: Map<string, AttemptRow>;
  readonly budgetDays: Map<string, BudgetDayRow>;
  readonly claims: Map<string, ClaimRow>;
  readonly decisions: Map<DecisionId, Decision>;
  readonly envValues: Map<EnvKey, EnvValueRow>;
  readonly events: ProjectEventInput[];
  readonly landings: LandingView[];
  readonly layerReads: LayerRead[];
  readonly layers: Map<LayerName, LayerRow>;
  readonly ledger: Map<number, LedgerRow>;
  readonly outbox: OutboxRow[];
  readonly project: Map<"row", ProjectRow>;
  readonly proposals: Map<ProposalId, Proposal>;
  readonly pushEvents: PushEventRow[];
  readonly queue: Map<"queue", LandingQueue>;
  readonly ratchets: Map<string, RatchetRow>;
}

const writesOf = (): Writes => ({
  answers: new Map(),
  asks: new Map(),
  attempts: new Map(),
  budgetDays: new Map(),
  claims: new Map(),
  decisions: new Map(),
  envValues: new Map(),
  events: [],
  landings: [],
  layerReads: [],
  layers: new Map(),
  ledger: new Map(),
  outbox: [],
  project: new Map(),
  proposals: new Map(),
  pushEvents: [],
  queue: new Map(),
  ratchets: new Map(),
});

const isEmpty = (writes: Writes) =>
  [
    writes.answers.size,
    writes.asks.size,
    writes.attempts.size,
    writes.budgetDays.size,
    writes.claims.size,
    writes.decisions.size,
    writes.envValues.size,
    writes.events.length,
    writes.landings.length,
    writes.layerReads.length,
    writes.layers.size,
    writes.ledger.size,
    writes.outbox.length,
    writes.project.size,
    writes.proposals.size,
    writes.pushEvents.length,
    writes.queue.size,
    writes.ratchets.size,
  ].every((count) => count === 0);

const keepLanding = (
  writes: Writes,
  landing: LandingView,
  now: DateTime.Utc
) => {
  writes.landings.push(landing);
  writes.events.push(ProjectEventInput.Landed({ at: now, landing }));
};

const keyIn = <A>(table: Table<A>, row: A) => {
  const columns = table.columns(row);

  return JSON.stringify(table.key.map((name) => columns[name]));
};

const overlaid = <A>(
  table: Table<A>,
  held: readonly A[],
  written: Iterable<A>
): readonly A[] => {
  const fresh = new Map(
    Array.map([...written], (row) => [keyIn(table, row), row])
  );

  const kept = new Set(held.map((row) => keyIn(table, row)));

  return [
    ...held.map((row) => fresh.get(keyIn(table, row)) ?? row),
    ...[...fresh.values()].filter((row) => !kept.has(keyIn(table, row))),
  ];
};

const bySeq = Order.mapInput(Order.Number, (entry: LedgerRow) => entry.seq);

const snapshotNow = (h: Hydrated, writes: Writes): ProjectSnapshot => {
  const held = h.snapshot;

  return {
    ...held,
    answers: overlaid(Tables.answers, held.answers, writes.answers.values()),
    asks: overlaid(Tables.asks, held.asks, writes.asks.values()),
    attempts: overlaid(
      Tables.attempts,
      held.attempts,
      writes.attempts.values()
    ),
    budgetDays: overlaid(
      Tables.budgetDays,
      held.budgetDays,
      writes.budgetDays.values()
    ),
    claims: overlaid(Tables.claims, held.claims, writes.claims.values()),
    decisions: overlaid(
      Tables.decisions,
      held.decisions,
      writes.decisions.values()
    ),
    envValues: overlaid(
      Tables.envValues,
      held.envValues,
      writes.envValues.values()
    ),
    landings: [...writes.landings.toReversed(), ...held.landings],
    layers: overlaid(Tables.layers, held.layers, writes.layers.values()),
    ledger: Array.sort(
      overlaid(Tables.ledger, held.ledger, writes.ledger.values()),
      bySeq
    ),
    outbox: [...held.outbox, ...writes.outbox],
    project: Option.orElse(
      Option.fromUndefinedOr(writes.project.get("row")),
      () => held.project
    ),
    proposals: overlaid(
      Tables.proposals,
      held.proposals,
      writes.proposals.values()
    ),
    ratchets: overlaid(
      Tables.ratchets,
      held.ratchets,
      writes.ratchets.values()
    ),
  };
};

const portTables = new Set<string>([
  "attempts",
  "decisions",
  "envValues",
  "events",
  "layerReads",
  "layers",
  "ledger",
  "outbox",
]);

const absorb = (writes: Writes, more: ProjectWrites) => {
  const foreign = Object.keys(more).filter((table) => !portTables.has(table));

  if (Array.isReadonlyArrayNonEmpty(foreign)) {
    return Effect.die(
      `a visibility port wrote ${foreign.join(", ")}, which the project service writes itself`
    );
  }

  for (const row of more.attempts ?? []) {
    writes.attempts.set(keyIn(Tables.attempts, row), row);
  }

  for (const row of more.decisions ?? []) {
    writes.decisions.set(row.id, row);
  }

  for (const row of more.envValues ?? []) {
    writes.envValues.set(row.key, row);
  }

  for (const row of more.layers ?? []) {
    writes.layers.set(row.name, row);
  }

  for (const row of more.ledger ?? []) {
    writes.ledger.set(row.seq, row);
  }

  writes.events.push(...(more.events ?? []));
  writes.layerReads.push(...(more.layerReads ?? []));
  writes.outbox.push(...(more.outbox ?? []));

  return Effect.void;
};

const applyPlan = (writes: Writes, plan: VisibilityPlan, now: DateTime.Utc) =>
  Effect.gen(function* () {
    yield* absorb(writes, plan.writes);

    yield* Effect.forEach(
      plan.effects,
      (effect) =>
        Effect.map(
          outboxRow(
            `visibility:${effect.id}`,
            OutboxBody.cases.Visibility.make({ effect }),
            now
          ),
          (row) => writes.outbox.push(row)
        ),
      { discard: true }
    );
  });

const claimKey = (ask: AskId, claimant: Handle) =>
  JSON.stringify([ask, claimant.toLowerCase()]);

const claimOf = (state: ClaimState): Option.Option<Live> =>
  ClaimState.match(state, {
    Answered: (claim) => Option.some<Live>(claim),
    Lapsed: (claim) => Option.some<Live>(claim),
    Live: (claim) => Option.some<Live>(claim),
    Open: () => Option.none(),
    Released: (claim) => Option.some<Live>(claim),
    Warned: (claim) => Option.some<Live>(claim),
  });

const isLive = ClaimState.isAnyOf(["Live", "Warned"]);

const deadlineOf = (state: ClaimState): Option.Option<DateTime.Utc> =>
  ClaimState.match(state, {
    Answered: () => Option.none(),
    Lapsed: () => Option.none(),
    Live: ({ warnsAt }) => Option.some(warnsAt),
    Open: () => Option.none(),
    Released: () => Option.none(),
    Warned: ({ lapsesAt }) => Option.some(lapsesAt),
  });

const isPlainPath = (path: string) =>
  path
    .split("/")
    .every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        segment !== ".git"
    );

const holds = (ask: Ask, wanted: AskKind["requires"][number]) =>
  Match.value(wanted).pipe(
    Match.when("want", () => ask.brief.want.length > 0),
    Match.when("current", () => ask.brief.current !== undefined),
    Match.when("outOfScope", () => ask.brief.outOfScope !== undefined),
    Match.when("terms", () => ask.brief.terms !== undefined),
    Match.when("context", () => ask.brief.context !== undefined),
    Match.whenOr("check", "territory", () => true),
    Match.exhaustive
  );

const sameSource = (a: ImportSource, b: ImportSource) =>
  a.url === b.url && a.branch === b.branch;

const field = <K extends string, A>(
  key: K,
  value: Option.Option<A>
): Partial<Record<K, A>> =>
  Option.match(value, {
    onNone: () => ({}),
    onSome: (present) => Record.singleton(key, present),
  });

const creditsFor = (ask: Ask, answerer: Handle): readonly Credit[] => [
  { handle: ask.askedBy, role: "Asked-by" },
  { handle: answerer, role: "Signed-off-by" },
  ...Option.toArray(
    Option.map(Option.fromUndefinedOr(ask.mentor), (handle): Credit => ({
      handle,
      role: "Mentored-by",
    }))
  ),
];

const askLaneOf = (policy: Policy, ask: Ask) =>
  commandFor(ask.check, policy.run, policy.ratchets);

const isCounted = CheckSpec.isAnyOf(["LintToZero", "Migrate", "SymbolAbsent"]);

const countsCallers = CheckSpec.isAnyOf(["Migrate", "SymbolAbsent"]);

const askCheckLane = (policy: Policy, ask: Ask) =>
  Option.map(askLaneOf(policy, ask), ({ command, lane }) =>
    isCounted(ask.check)
      ? CheckLane.make({ command, lane, output: "stdout" })
      : CheckLane.make({ command, lane })
  );

const lanesOf = (
  policy: Policy,
  ask: Option.Option<Ask>
): readonly CheckLane[] => [
  ...Option.toArray(
    Option.flatMap(ask, (asked) => askCheckLane(policy, asked))
  ),
  ...Record.toEntries(policy.run.checks).map(([lane, command]) =>
    CheckLane.make({ command, lane })
  ),
];

const countedBy = (policy: Policy, command: string, stdout: string) =>
  Effect.map(
    Effect.forEach(
      policy.ratchets.filter((spec) => spec.measure.command === command),
      (spec) =>
        measure(
          spec,
          () => Effect.succeed({ code: 0, stdout }),
          policy.modules
        ).pipe(
          Effect.catchTag("CountUnreadable", (unread) =>
            Effect.as(
              Effect.logWarning(
                `the ratchet ${spec.name} has no count in what its command printed`,
                unread
              ),
              []
            )
          )
        )
    ),
    (counts): readonly RatchetCount[] => counts.flat()
  );

const ratchetKey = (row: {
  readonly ratchet: string;
  readonly territory: string;
}) => JSON.stringify([row.ratchet, row.territory]);

const baselineOf = (row: RatchetRow): RatchetBaseline => ({
  count: row.count,
  ratchet: row.ratchet,
  setAt: row.at,
  territory: row.territory,
});

const isEscapeRow = (row: {
  readonly ratchet: string;
  readonly territory: string;
}) => row.ratchet === escapeRatchet(row.territory);

const sameEscape = (one: Waiver) => (other: Waiver) =>
  other.ask === one.ask &&
  other.marker === one.marker &&
  other.reason === one.reason &&
  other.at.path === one.at.path &&
  other.at.line === one.at.line;

interface DecidedOn {
  readonly choice: Choice;
  readonly subject: PendingDecision["subject"];
}

const decidedOn = (
  before: LandingState,
  command: LandingCommand
): Option.Option<DecidedOn> =>
  LandingCommand.$is("Decided")(command) &&
  LandingState.guards.AwaitingDecision(before)
    ? Option.map(
        Option.fromUndefinedOr(
          before.decisions.find(({ id }) => id === command.decision)
        ),
        ({ subject }) => ({ choice: command.choice, subject })
      )
    : Option.none();

const waivedAfter = (
  waived: readonly Waiver[],
  decided: Option.Option<DecidedOn>
): readonly Waiver[] => [
  ...waived,
  ...Option.toArray(
    Option.flatMap(decided, ({ choice, subject }) =>
      choice === "accept" && DecisionSubject.guards.Waiver(subject)
        ? Option.some(subject)
        : Option.none()
    )
  ),
];

const evidenceFor = (
  request: Request,
  subject: Waiver | RaiseRatchet
): readonly Evidence[] => [
  {
    label: "answer",
    value: `${request.answerer} at ${request.head} (${request.requestId})`,
  },
  DecisionSubject.guards.Waiver(subject)
    ? {
        label: "escape",
        value: `${subject.at.path}:${subject.at.line}: ${subject.marker} -- ${subject.reason}`,
      }
    : {
        label: "ratchet",
        value: `${subject.ratchet} in ${subject.territory}: ${subject.before} to ${subject.after}`,
      },
];

const redByCount = (input: {
  readonly ask: Ask;
  readonly check: LintToZeroCheck;
  readonly lane: LaneName;
  readonly policy: Policy;
  readonly runs: readonly [CheckRun, CheckRun];
}) =>
  Effect.gen(function* () {
    const { ask, check, policy } = input;

    const read = (run: CheckRun) =>
      Effect.fromOption(outputOf(run, input.lane)).pipe(
        Effect.flatMap((stdout) =>
          Effect.map(
            lintToZeroCount({
              asked: ask.territory,
              check,
              modules: policy.modules,
              stdout,
            }),
            (count) => ({ count, stdout })
          )
        ),
        Effect.mapError(() => new NotRedFirst({}))
      );

    const [first, second] = input.runs;
    const once = yield* read(first);
    const again = yield* read(second);

    if (once.count === 0 || once.count !== again.count) {
      return yield* new NotRedFirst({});
    }

    return yield* countedBy(policy, check.command, once.stdout);
  });

const section = (heading: string, lines: readonly string[] | undefined) =>
  lines === undefined || lines.length === 0
    ? []
    : ["", `## ${heading}`, "", ...lines];

const listed = (lines: readonly string[] | undefined) =>
  lines?.map((line) => `- ${line}`);

const checkLine = (check: CheckSpec) =>
  CheckSpec.match(check, {
    LintToZero: ({ rule }) =>
      `The lint rule \`${rule}\` reports nothing in the territory.`,
    Migrate: ({ from, to }) =>
      to === undefined
        ? `No caller uses \`${from}\`.`
        : `No caller uses \`${from}\`; they use \`${to}\`.`,
    Ratchet: ({ ratchet }) => `The ratchet \`${ratchet}\` goes down.`,
    RedThenGreen: ({ path }) =>
      `\`${path}\` fails on main by an assertion; it passes once answered.`,
    SymbolAbsent: ({ symbol }) => `Nothing uses \`${symbol}\` any more.`,
  });

const briefOf = (ask: Ask): string => {
  const { brief, territory } = ask;
  const paths = territory.paths.map((path) => `\`${path}\``).join(", ");

  return [
    `# ${brief.want}`,
    "",
    `Ask \`${ask.id}\` in ${ask.project}, a \`${ask.kind}\` ask from ${ask.askedBy}.`,
    // A paths territory (module `.`) is no module a reader would know: it
    // reads as its paths alone.
    ...section("Territory", [
      territory.module === "."
        ? `The paths ${paths}.`
        : `The module \`${territory.module}\`: ${paths}.`,
    ]),
    ...section(
      "Current",
      Option.toArray(Option.fromUndefinedOr(brief.current))
    ),
    ...section("Check", [checkLine(ask.check)]),
    ...section("Out of scope", listed(brief.outOfScope)),
    ...section("Terms", listed(brief.terms)),
    ...section("Context", listed(brief.context)),
    "",
  ].join("\n");
};

const submitRefusal = (refusal: Refusal, ask: AskId): SubmitRefusal =>
  Match.value(refusal).pipe(
    Match.tag(
      "ClaimLapsed",
      "NotClaimed",
      "OutOfScope",
      "PrivatePathInPublicTree",
      "ReachedInternals",
      "RepoBusy",
      "StaleBase",
      "TouchedJudge",
      "Weakened",
      (kept): SubmitRefusal => kept
    ),
    Match.orElse(() => NotClaimed.of(ask))
  );

const withAgent = (
  agents: readonly AgentTrailer[],
  audit: HarnessAudit | undefined
): readonly AgentTrailer[] => {
  if (audit?.harness === undefined) {
    return agents;
  }

  const agent: AgentTrailer = {
    harness: audit.harness,
    verified: false,
    ...(audit.model !== undefined && { model: audit.model }),
  };

  return agents.some(
    ({ harness, model }) => harness === agent.harness && model === agent.model
  )
    ? agents
    : [...agents, agent];
};

const disclosed = (
  policy: Policy,
  claim: Option.Option<ClaimRow>
): readonly AgentTrailer[] =>
  policy.agents === "none"
    ? []
    : Option.match(claim, {
        onNone: () => [],
        onSome: ({ assisted }) => assisted ?? [],
      });

const heldBackTrailerOf = (
  record: { readonly heldBack?: HeldBackJudged },
  tree: TreeSha
): Option.Option<string> =>
  Option.flatMap(
    Option.filter(
      Option.fromUndefinedOr(record.heldBack),
      (held) => held.tree === tree
    ),
    ({ trailer }) => Option.fromUndefinedOr(trailer)
  );

const messageOf = (
  request: Request,
  ask: Option.Option<Ask>,
  verdict: Verdict,
  heldBack: Option.Option<string> = Option.none()
): string => {
  const message = {
    assisted: request.assisted,
    credits: request.credits,
    requestId: request.requestId,
    subject: "Land a change",
    verdict: { checkVersion: verdict.checkVersion, patchId: verdict.patchId },
    ...field("heldBack", heldBack),
  };

  return formatLanding(
    Option.match(ask, {
      onNone: () => message,
      onSome: ({ brief, id, project }) => ({
        ...message,
        ask: { ask: id, project },
        body: brief.want,
        subject: `Answer ${id}`,
      }),
    })
  );
};

const byUpdated = Order.mapInput(
  DateTime.Order,
  ({ row }: Answered) => row.updatedAt
);

const landedVerdict = (verdict: Option.Option<Verdict>, sha: LandedSha) =>
  Option.map(verdict, (made): Verdict => ({
    ...made,
    outcome: Outcome.cases.Landed.make({ sha }),
  }));

const withVerdict = (
  event: ProjectEventInput,
  verdict: Option.Option<Verdict>
): ProjectEventInput =>
  Match.value(event).pipe(
    Match.tag("Landed", (landed): ProjectEventInput => ({
      ...landed,
      landing: {
        ...landed.landing,
        ...field("verdict", landedVerdict(verdict, landed.landing.sha)),
      },
    })),
    Match.orElse((other) => other)
  );

const runnable = (effect: LandingEffect): effect is RunnableEffect =>
  isStep(effect) || LandingEffect.$is("Retry")(effect);

const isTouchedJudge = (refusal: Refusal): refusal is TouchedJudge =>
  Match.value(refusal).pipe(
    Match.tag("TouchedJudge", () => true),
    Match.orElse(() => false)
  );

type Checking = Extract<LandingState, { readonly _tag: "Checking" }>;

type Landing = Extract<LandingState, { readonly _tag: "Landing" }>;

interface Settled {
  readonly queue: LandingQueue;
  readonly steps: readonly LandingEffect[];
}

const startOther = (
  writes: Writes,
  admitted: Option.Option<RequestId>,
  advancing: RequestId,
  now: DateTime.Utc
) =>
  Option.match(
    Option.filter(admitted, (id) => id !== advancing),
    {
      onNone: () => Effect.void,
      onSome: (id) =>
        Effect.map(startRow(id, now), (row) => writes.outbox.push(row)),
    }
  );

interface Watch {
  readonly ran: (
    lane: LaneName,
    runs: readonly [CheckRun, CheckRun]
  ) => Effect.Effect<void>;
  readonly stdout: boolean;
}

const unwatched: Watch = { ran: () => Effect.void, stdout: false };

interface Seen {
  readonly lane: LaneName;
  readonly runs: readonly [CheckRun, CheckRun];
}

type FinalRefusal =
  | IncompleteBrief
  | NotDecider
  | NotRedFirst
  | TouchedJudge
  | WeakCheck;

const readingOf = (run: CheckRun, lane: LaneName) => {
  const result = run.lanes.find((each) => each.lane === lane)?.result;

  const signed = run.evidence.some(
    (each) => each.lane === lane && each.signature !== undefined
  );

  return result === "failed" && !signed ? "loadError" : (result ?? "blocked");
};

const notRedBecause = ({ lane, runs }: Seen): Diagnosis => {
  const readings = runs.map((run) => readingOf(run, lane));

  if (readings.every((reading) => reading === "passed")) {
    return "Passed";
  }

  if (readings.includes("blocked")) {
    return "Blocked";
  }

  return readings.includes("loadError") ? "LoadError" : "Flaky";
};

const diagnosisOf = (
  refusal: FinalRefusal,
  seen: Option.Option<Seen>
): Diagnosis =>
  Match.valueTags(refusal, {
    IncompleteBrief: (): Diagnosis => "Brief",
    NotDecider: (): Diagnosis => "Brief",
    NotRedFirst: () =>
      Option.match(seen, {
        onNone: (): Diagnosis => "Brief",
        onSome: notRedBecause,
      }),
    TouchedJudge: (): Diagnosis => "Judge",
    WeakCheck: ({ weakness }): Diagnosis =>
      weakness === "no assertion" ? "NoTests" : "Weak",
  });

const excerptOf = (seen: Option.Option<Seen>) =>
  Option.match(
    Option.flatMap(seen, ({ lane, runs: [first, second] }) =>
      Option.orElse(outputOf(second, lane), () => outputOf(first, lane))
    ),
    {
      onNone: () => "",
      onSome: (printed) => tailOf(printed, EXCERPT_BYTES).text,
    }
  );

const rehearsalRefused = (
  refusal: FinalRefusal,
  seen: Option.Option<Seen>
): Rehearsal =>
  Rehearsal.cases.Refused.make({
    diagnosis: diagnosisOf(refusal, seen),
    excerpt: excerptOf(seen),
    refusal,
  });

const redOf = ({ lane, runs }: Seen) => ({
  lane,
  signature: Result.match(redFirstOfRuns(runs, lane), {
    onFailure: () => "red by its count",
    onSuccess: ({ signature }) => signature,
  }),
});

const weakness = (ask: Ask, files: readonly AskFile[]) => {
  const { check } = ask;

  const file = CheckSpec.guards.RedThenGreen(check)
    ? Option.fromUndefinedOr(files.find(({ path }) => path === check.path))
    : Option.none<AskFile>();

  return Option.flatMap(file, (found) =>
    Array.head(weaknessesOf(found, ask.territory.paths))
  );
};

const refusedAt = (
  stage: StageName,
  refusals: readonly Refusal[]
): Option.Option<StageRefusal> =>
  Option.map(
    Option.liftPredicate(refusals, Array.isReadonlyArrayNonEmpty),
    (all) => ({ refusals: all, stage })
  );

// A fork the host lacks is refused as parse would refuse it; a commit it lacks,
// as a merge would.
const gateOf = (
  facts: Effect.Effect<PushFacts, RepoNotFound | MissingCommit>,
  missing: readonly Refusal[],
  stale: readonly Refusal[]
): Effect.Effect<Option.Option<StageRefusal>> =>
  facts.pipe(
    Effect.flatMap((each) => refusingStage(pushStages, each)),
    Effect.catchTags({
      MissingCommit: () => Effect.succeed(refusedAt("merge", stale)),
      RepoNotFound: () => Effect.succeed(refusedAt("parse", missing)),
    })
  );

/** The stage whose refusals moved an answer from `before` to `Refused`. */
const refusingStageOf = (
  before: LandingState,
  report: AnswerReport | undefined
): StageName =>
  LandingState.matchOrElse<StageName>(
    before,
    {
      AwaitingDecision: () => "human",
      Checking: () => report?.stage ?? "checks",
      Landing: () => "merge",
      Merging: () => "merge",
    },
    () => "checks"
  );

const waitedPoints = (input: {
  readonly before: LandingState;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  readonly queuedAt: DateTime.Utc | undefined;
  readonly state: LandingState;
}): readonly MetricPoint[] =>
  LandingState.guards.Merging(input.before) &&
  LandingState.guards.Checking(input.state) &&
  input.state.remerges === 0 &&
  input.queuedAt !== undefined
    ? [
        MetricPoint.cases.ChecksWaited.make({
          project: input.project,
          waitedMs: millisBetween(input.queuedAt, input.now),
        }),
      ]
    : [];

/**
 * What one step of an answer's landing counts, each under the fact it counts:
 * its refusal, its checked lanes, and the wait before its first checks. A
 * report that changes nothing counts nothing, so a replay writes no row.
 */
const answerPoints = (input: {
  readonly before: LandingState;
  readonly command: LandingCommand;
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  readonly queuedAt: DateTime.Utc | undefined;
  readonly report: AnswerReport | undefined;
  readonly requestId: RequestId;
  readonly state: LandingState;
}): Effect.Effect<readonly OutboxRow[]> => {
  const { before, command, now, project, report, requestId, state } = input;

  const refused =
    LandingState.guards.Refused(state) && !LandingState.guards.Refused(before)
      ? refusedPoints(project, refusingStageOf(before, report), state.refusals)
      : [];

  const checkedTree =
    LandingCommand.$is("Checked")(command) &&
    LandingState.guards.Checking(before) &&
    before.tree === command.tree &&
    state !== before
      ? Option.some(before.tree)
      : Option.none();

  return Effect.map(
    Effect.all([
      measuredRow(`waited:${requestId}`, waitedPoints(input), now),
      Option.match(checkedTree, {
        onNone: () => Effect.succeed([]),
        onSome: (tree) =>
          measuredRow(
            `lanes:${requestId}:${tree}`,
            lanePoints(project, report?.lanes ?? []),
            now
          ),
      }),
      measuredRow(`refused:${requestId}`, refused, now),
    ]),
    (rows) => rows.flat()
  );
};

const leaveIfDone = (
  writes: Writes,
  queue: LandingQueue,
  input: {
    readonly now: DateTime.Utc;
    readonly requestId: RequestId;
    readonly state: LandingState;
  }
) => {
  const { requestId } = input;

  const inLine = holdsSlot(queue, requestId) || queue.order.includes(requestId);

  if (LandingState.guards.Landing(input.state) || !inLine) {
    return Effect.succeed(queue);
  }

  const left = leave(queue, requestId);

  return Effect.as(
    startOther(writes, left.admitted, requestId, input.now),
    left.queue
  );
};

const namesNoAsk = (landing: LandingView) =>
  landing.ask === undefined && landing.opened === undefined;

export const projectService = (
  name: ProjectName
): Effect.Effect<ProjectApi, never, ProjectPorts> =>
  Effect.gen(function* () {
    const ports = yield* Effect.context<ProjectPorts>();
    const store = Context.get(ports, ProjectStore);
    const host = Context.get(ports, RepoHost);
    const lander = Context.get(ports, Lander);
    const runner = Context.get(ports, CheckRunner);
    const rules = Context.get(ports, RulesEvaluator);
    const alarms = Context.get(ports, Alarms);
    // Read once, as the ports are: a call runs in its caller's context.
    const generate = yield* ProjectGenerator;
    const visibility = yield* ProjectVisibility;
    const envPort = yield* ProjectEnv;
    const draftRuns = yield* DraftRuns;
    const metrics = yield* Metrics;
    const lock = yield* Semaphore.make(1);
    const repo = RepoName.make(keyOf(name));

    const withPorts = <A, E>(effect: Effect.Effect<A, E, ProjectPorts>) =>
      Effect.provideContext(effect, ports);

    const hydrate: Effect.Effect<Hydrated> = Effect.gen(function* () {
      const snapshot = yield* store.load();

      const policy = yield* Option.match(
        Option.flatMap(snapshot.project, (row) =>
          Option.fromUndefinedOr(row.policy)
        ),
        {
          onNone: () => Effect.succeedNone,
          onSome: (json) => Effect.asSome(Effect.orDie(decodePolicy(json))),
        }
      );

      const claims = yield* Effect.forEach(snapshot.claims, (row) =>
        Effect.map(Effect.orDie(decodeClaim(row.state)), (state) => ({
          row,
          state,
        }))
      );

      const answers = yield* Effect.forEach(snapshot.answers, (row) =>
        Effect.map(Effect.orDie(decodeAnswer(row.state)), (record) => ({
          record,
          row,
        }))
      );

      return {
        answers,
        asks: new Map(snapshot.asks.map((ask) => [ask.id, ask])),
        budgetDays: snapshot.budgetDays,
        claims,
        decisions: snapshot.decisions,
        landings: snapshot.landings,
        lastSeq: snapshot.lastSeq,
        outbox: snapshot.outbox,
        policy,
        project: snapshot.project,
        proposals: snapshot.proposals,
        queue: yield* queueOf(snapshot.queue),
        ratchets: snapshot.ratchets,
        snapshot,
      };
    });

    const liveRow = (h: Hydrated) =>
      Option.flatMap(h.project, (row) =>
        row.state === "live" && row.landed !== undefined
          ? Option.some({ landed: row.landed, row })
          : Option.none()
      );

    const askNow = (h: Hydrated, writes: Writes, id: AskId) =>
      Option.fromUndefinedOr(writes.asks.get(id) ?? h.asks.get(id));

    const ratchetsNow = (
      h: Hydrated,
      writes: Writes
    ): readonly RatchetRow[] => [
      ...h.ratchets.map((row) => writes.ratchets.get(ratchetKey(row)) ?? row),
      ...[...writes.ratchets.values()].filter(
        (row) =>
          !h.ratchets.some((held) => ratchetKey(held) === ratchetKey(row))
      ),
    ];

    const baselinesNow = (h: Hydrated, writes: Writes) =>
      ratchetsNow(h, writes)
        .filter((row) => !isEscapeRow(row))
        .map(baselineOf);

    const putRatchets = (
      h: Hydrated,
      writes: Writes,
      baselines: readonly RatchetBaseline[]
    ) => {
      const held = new Map(
        ratchetsNow(h, writes).map((row) => [ratchetKey(row), row])
      );

      for (const baseline of baselines) {
        const row: RatchetRow = {
          at: baseline.setAt,
          count: baseline.count,
          ratchet: baseline.ratchet,
          territory: baseline.territory,
        };

        const before = held.get(ratchetKey(row));

        if (before?.count !== row.count || before.at !== row.at) {
          writes.ratchets.set(ratchetKey(row), row);
        }
      }
    };

    const ownClaim = (h: Hydrated, ask: AskId, handle: Handle) =>
      Option.fromUndefinedOr(
        h.claims.find(
          ({ row }) => row.ask === ask && sameHandle(row.claimant, handle)
        )
      );

    const claimRowNow = (
      h: Hydrated,
      writes: Writes,
      ask: AskId,
      claimant: Handle
    ): ClaimRow | undefined =>
      writes.claims.get(claimKey(ask, claimant)) ??
      Option.getOrUndefined(ownClaim(h, ask, claimant))?.row;

    const heldBy = (h: Hydrated, handle: Handle, except?: AskId) =>
      h.claims.filter(
        ({ row, state }) =>
          isLive(state) &&
          row.ask !== except &&
          sameHandle(row.claimant, handle)
      ).length;

    const findAnswer = (h: Hydrated, requestId: RequestId) =>
      Option.fromUndefinedOr(
        h.answers.find(({ row }) => row.requestId === requestId)
      );

    const claimsPolicy = (h: Hydrated) =>
      Option.getOrElse(
        Option.map(h.policy, ({ claims }) => claims),
        () => defaultClaims
      );

    const viewOf = (
      policy: Option.Option<Policy>,
      ask: Option.Option<Ask>,
      state: ClaimState,
      pinned: PinnedSuite | undefined
    ) =>
      Effect.gen(function* () {
        const gateway = yield* GatewayUrl;

        const checkCommand = Option.getOrElse(
          Option.flatMap(
            Option.all({ ask, policy }),
            ({ ask: asked, policy: at }) =>
              Option.map(askLaneOf(at, asked), ({ command }): string => command)
          ),
          () => `${Brand.cli} check`
        );

        return Option.flatMap(claimOf(state), ({ fork }) =>
          Option.map(
            toView(state, {
              checkCommand,
              project: name,
              remote: `${gateway}/${Option.getOrElse(addressOfRepo(fork), () => fork)}.git`,
            }),
            (view): ClaimView =>
              pinned === undefined ? view : { ...view, suite: pinned.suite }
          )
        );
      });

    /** Only a reader of every layer may hear which layer paths collide. */
    const readsEveryLayer = (who: Principal, snapshot: ProjectSnapshot) => {
      const readable = visibility.readableLayers(who, snapshot);

      return (
        snapshot.layers.length > 0 &&
        snapshot.layers.every((row) => readable.has(row.name))
      );
    };

    const layered = (snapshot: ProjectSnapshot, facts: PushFacts) =>
      Effect.map(visibility.layerPaths(snapshot), (layerPaths): PushFacts => ({
        ...facts,
        canReadLayers: readsEveryLayer(facts.pusher, snapshot),
        layerPaths,
      }));

    const withLayerFacts = <E>(
      h: Hydrated,
      writes: Writes,
      facts: Effect.Effect<PushFacts, E, ProjectPorts>
    ): Effect.Effect<PushFacts, E> =>
      withPorts(facts).pipe(
        Effect.flatMap((found) => layered(snapshotNow(h, writes), found))
      );

    const commit = (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
      Effect.gen(function* () {
        if (isEmpty(writes)) {
          return [];
        }

        const events = yield* numbered(h.lastSeq, writes.events);
        const projected = yield* projectedRows(name, events, now);

        // A landing is kept once, by its SHA, whichever call made it.
        const landed = yield* Effect.forEach(writes.landings, ({ sha }) =>
          measuredRow(
            `landed:${sha}`,
            [MetricPoint.cases.Landed.make({ project: name })],
            now
          )
        );

        const outbox = [...writes.outbox, ...landed.flat(), ...projected];

        const queue = yield* Effect.forEach(writes.queue.values(), (each) =>
          storedQueue(each)
        );

        const all: ProjectWrites = {
          answers: [...writes.answers.values()],
          asks: [...writes.asks.values()],
          attempts: [...writes.attempts.values()],
          budgetDays: [...writes.budgetDays.values()],
          claims: [...writes.claims.values()],
          decisions: [...writes.decisions.values()],
          envValues: [...writes.envValues.values()],
          events: writes.events,
          landings: writes.landings,
          layerReads: writes.layerReads,
          layers: [...writes.layers.values()],
          ledger: [...writes.ledger.values()],
          outbox,
          proposals: [...writes.proposals.values()],
          pushEvents: writes.pushEvents,
          ratchets: [...writes.ratchets.values()],
          ...field(
            "project",
            Option.fromUndefinedOr(writes.project.get("row"))
          ),
          ...field("queue", Array.head(queue)),
        };

        const committed = yield* store.commit(all);

        if (committed.duplicatePushEvents.length > 0) {
          return [];
        }

        const expected = events.map(({ seq }) => seq);

        if (
          committed.seqs.length !== expected.length ||
          committed.seqs.some((seq, index) => seq !== expected[index])
        ) {
          return yield* Effect.die(
            "the store numbered a commit's events otherwise than its projection rows"
          );
        }

        return outbox;
      });

    const armAlarm = Effect.gen(function* () {
      const h = yield* hydrate;

      const deadlines = [
        ...h.claims.flatMap(({ state }) => Option.toArray(deadlineOf(state))),
        ...deciderDeadlines(h),
        ...h.outbox.map(({ notBefore }) => notBefore),
      ];

      if (Array.isReadonlyArrayNonEmpty(deadlines)) {
        yield* alarms.set(Array.min(deadlines, DateTime.Order));
      }
    });

    const settle = (queue: AnswerQueue, rows: readonly OutboxRow[]) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;

        const due = Array.dedupeWith(
          rows.filter((row) => isDue(row, now)),
          (one, other) => one.id === other.id
        );

        if (Array.isReadonlyArrayNonEmpty(due)) {
          const ran = yield* withPorts(
            runOutbox(due, queue, now, store.ackOutbox)
          ).pipe(
            Effect.provideService(DraftRuns, draftRuns),
            Effect.provideService(Metrics, metrics)
          );

          yield* store.ackOutbox(ran.done);

          if (Array.isReadonlyArrayNonEmpty(ran.retry)) {
            yield* lock.withPermits(1)(store.commit({ outbox: ran.retry }));
          }
        }

        yield* armAlarm;
      });

    const writeLocked = <A, E>(
      queue: AnswerQueue,
      body: (
        h: Hydrated,
        writes: Writes,
        now: DateTime.Utc
      ) => Effect.Effect<A, E>
    ): Effect.Effect<A, E> =>
      Effect.gen(function* () {
        const [answered, rows] = yield* lock.withPermits(1)(
          Effect.gen(function* () {
            const h = yield* hydrate;
            const now = yield* DateTime.now;
            const writes = writesOf();
            const result = yield* body(h, writes, now);

            return [result, yield* commit(h, writes, now)] as const;
          })
        );

        yield* settle(queue, rows);

        return answered;
      });

    const askAfter = (
      h: Hydrated,
      writes: Writes,
      ask: AskId,
      step: ClaimStep
    ) => {
      const open = Option.filter(
        askNow(h, writes, ask),
        ({ state }) =>
          state !== "closed" && !ClaimState.guards.Answered(step.state)
      );

      if (Option.isNone(open)) {
        return;
      }

      const claimant = Option.map(
        claimOf(step.state),
        (claim) => claim.claimant
      );

      const others = h.claims.some(
        ({ row, state }) =>
          row.ask === ask &&
          isLive(state) &&
          !Option.exists(claimant, (each) => sameHandle(row.claimant, each))
      );

      const next = isLive(step.state) || others ? "claimed" : "open";

      if (next !== open.value.state) {
        writes.asks.set(ask, { ...open.value, state: next });
      }
    };

    const applyClaim = (
      h: Hydrated,
      writes: Writes,
      ask: AskId,
      step: ClaimStep,
      now: DateTime.Utc,
      assisted?: readonly AgentTrailer[],
      pinned?: Option.Option<PinnedSuite>
    ) =>
      Effect.gen(function* () {
        const claim = claimOf(step.state);

        if (Option.isNone(claim)) {
          return;
        }

        const { claimant } = claim.value;

        const agents =
          assisted ?? claimRowNow(h, writes, ask, claimant)?.assisted ?? [];

        // A claim granted anew is pinned to the suite sealed now; any other
        // step keeps the suite it was pinned to.
        const suite =
          pinned ??
          Option.fromUndefinedOr(claimRowNow(h, writes, ask, claimant)?.pinned);

        writes.claims.set(claimKey(ask, claimant), {
          ask,
          claimant,
          state: yield* Effect.orDie(encodeClaim(step.state)),
          updatedAt: now,
          ...(agents.length > 0 && { assisted: agents }),
          ...field("pinned", suite),
        });

        yield* Effect.forEach(
          step.effects,
          (effect) =>
            ClaimEffect.$match(effect, {
              Emit: ({ event }) => Effect.sync(() => writes.events.push(event)),
              MakeFork: ({ from, name: fork }) =>
                Effect.map(
                  outboxRow(
                    `fork:${fork}`,
                    OutboxBody.cases.MakeFork.make({ from, name: fork }),
                    now
                  ),
                  (row) => writes.outbox.push(row)
                ),
              // Custody reads the claim's state: a lapsed or released claim's
              // fork takes no push, and the fork stays.
              RevokeAccess: () => Effect.void,
              // The alarm is set once settled, to the earliest deadline of all.
              SetAlarm: () => Effect.void,
            }),
          { discard: true }
        );

        askAfter(h, writes, ask, step);
      });

    const evaluateAt = (row: ProjectRow, at: LandedSha, now: DateTime.Utc) =>
      Effect.gen(function* () {
        const previous = yield* Option.match(
          Option.fromUndefinedOr(row.policy),
          {
            onNone: () => Effect.succeedNone,
            onSome: (json) => Effect.asSome(Effect.orDie(decodePolicy(json))),
          }
        );

        const vouchFile = Option.getOrElse(
          Option.map(previous, ({ vouch }) => vouch.file),
          () => RepoPath.make(`${Brand.configDir}/vouched.td`)
        );

        const bundle = yield* Effect.option(lander.bundleRules({ at, repo }));

        if (Option.isNone(bundle)) {
          yield* Effect.logWarning(
            `the config folder at ${at} could not be read`
          );

          return Option.none<Policy>();
        }

        const facts = yield* withPorts(
          evaluationFacts(repo, at, {
            initializer: row.initializer,
            now,
            project: name,
            vouchFile,
          })
        );

        return yield* rules.evaluate({ at, facts, modules: bundle.value }).pipe(
          Effect.asSome,
          Effect.catchTag("RulesFailed", (failed) =>
            Effect.as(
              Effect.logWarning(`the policy at ${at} did not evaluate`, failed),
              Option.none<Policy>()
            )
          )
        );
      });

    const withPolicyAt = (row: ProjectRow, at: LandedSha, now: DateTime.Utc) =>
      Effect.flatMap(evaluateAt(row, at, now), (policy) =>
        Option.match(policy, {
          onNone: () => Effect.succeed(row),
          onSome: (found) =>
            Effect.map(Effect.orDie(encodePolicy(found)), (encoded) => ({
              ...row,
              policy: encoded,
              policyAt: at,
            })),
        })
      );

    const hasConfigAt = (at: LandedSha) =>
      Effect.gen(function* () {
        const landedCommit = yield* host.readCommit(repo, at);

        if (Option.isNone(landedCommit)) {
          return false;
        }

        const root = yield* host.readTree(repo, landedCommit.value.tree);

        return Option.exists(root, (entries) =>
          entries.some(
            ({ name: entry, type }) =>
              entry === Brand.configDir && type === "tree"
          )
        );
      }).pipe(Effect.orDie);

    const policyStatus: Effect.Effect<PolicyStatus> = Effect.gen(function* () {
      const h = yield* hydrate;

      const origin = field(
        "importedFrom",
        Option.flatMapNullishOr(h.project, (row) => row.importedFrom)
      );

      if (Option.isSome(h.policy)) {
        return { ...origin, policy: publicPolicy(h.policy.value) };
      }

      const landed = Option.flatMapNullishOr(h.project, (row) => row.landed);

      if (Option.isNone(landed)) {
        return origin;
      }

      const at = landed.value;

      return {
        ...origin,
        unevaluated: {
          at,
          reason: (yield* hasConfigAt(at))
            ? ("configFailed" as const)
            : ("noConfig" as const),
        },
      };
    });

    /** Older landing rows carry no `opened`: it is found from the asks' `openedIn`. */
    const withOpened = (found: readonly LandingView[]) =>
      Effect.gen(function* () {
        if (!found.some(namesNoAsk)) {
          return found;
        }

        const { asks } = yield* store.load();

        const openedIn = new Map<string, AskId>();

        for (const ask of asks) {
          if (ask.parent === undefined && !openedIn.has(ask.openedIn)) {
            openedIn.set(ask.openedIn, ask.id);
          }
        }

        return found.map((landing) => {
          const opened = openedIn.get(landing.sha);

          return namesNoAsk(landing) && opened !== undefined
            ? { ...landing, opened }
            : landing;
        });
      });

    const textAt = (at: LandedSha) => (path: string) =>
      host
        .readFile(repo, Revision.Commit({ sha: at }), RepoPath.make(path))
        .pipe(
          Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes))),
          Effect.orDie
        );

    const landFollowUp = (input: {
      readonly h: Hydrated;
      readonly landed: LandedSha;
      readonly landing: LandingView;
      readonly now: DateTime.Utc;
      readonly policy: Exclude<ProjectRow["policy"], undefined>;
      readonly row: ProjectRow;
      readonly writes: Writes;
    }) =>
      Effect.gen(function* () {
        const { h, landed, landing, now, row, writes } = input;

        const made = yield* generatedFollowUp(
          {
            after: yield* Effect.orDie(decodePolicy(input.policy)),
            before: h.policy,
            initializer: row.initializer,
            landing,
            project: name,
            read: textAt(landed),
          },
          generate
        );

        if (Option.isNone(made)) {
          return;
        }

        const { author, credits, message, requestId } = made.value;

        const files = Array.map(made.value.files, ({ content, path }) => ({
          content,
          path: RepoPath.make(path),
        }));

        const composed = yield* lander.compose({ files, main: landed, repo });

        const { sha } = yield* lander.land({
          author,
          main: landed,
          message,
          rebuild: Rebuild.Compose({ files }),
          repo,
          requestId,
          tree: composed.tree,
          verdict: Option.none(),
        });

        const view: LandingView = {
          assisted: [],
          author,
          credits,
          landedAt: now,
          parent: landed,
          project: name,
          requestId,
          sha,
        };

        const moved = yield* withPolicyAt({ ...row, landed: sha }, sha, now);

        keepLanding(writes, view, now);
        writes.project.set("row", moved);
      });

    /**
     * When main still stands at `landed`, the failure is only logged. When main
     * moved on (the Lander's answer was lost) or can't be read, the call fails,
     * so the landed SHA never falls behind main; a rerun finds both commits by
     * their request ids.
     */
    const unlanded = <E>(landed: LandedSha, cause: Cause.Cause<E>) =>
      Effect.gen(function* () {
        const refs = yield* Effect.option(host.refs(repo));

        if (Option.exists(refs, (all) => all.get(mainRef) === landed)) {
          return yield* Effect.logWarning(
            "the regenerated contribute skill and AGENTS.md block did not land",
            cause
          );
        }

        yield* Effect.logError(
          `main moved past ${landed} while the regenerated files landed: the call records nothing, so it can run again`,
          cause
        );

        return yield* Effect.orDie(Effect.failCause(cause));
      });

    /**
     * A separate landing on top, never joined to the one that changed the
     * config (land only the checked tree). Bookkeeping: a failure is logged
     * and the next config change writes the files again.
     */
    const followUp = (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
      Effect.gen(function* () {
        const row = writes.project.get("row");
        const landed = row?.landed;
        const policy = row?.policy;

        if (
          row === undefined ||
          policy === undefined ||
          landed === undefined ||
          row.policyAt !== landed ||
          Option.exists(h.project, (before) => before.landed === landed)
        ) {
          return;
        }

        const requestId = generatedRequestId(landed);
        const landing = writes.landings.find(({ sha }) => sha === landed);

        const followed = [...h.landings, ...writes.landings].some(
          (each) => each.requestId === requestId
        );

        if (landing === undefined || followed) {
          return;
        }

        yield* landFollowUp({
          h,
          landed,
          landing,
          now,
          policy,
          row,
          writes,
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : unlanded(landed, cause)
          )
        );
      });

    const visibilityAfter = (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
      Effect.gen(function* () {
        const row = writes.project.get("row");
        const landed = row?.landed;

        const before = Option.flatMap(h.project, (held) =>
          Option.fromUndefinedOr(held.landed)
        );

        if (
          row === undefined ||
          landed === undefined ||
          Option.contains(before, landed)
        ) {
          return;
        }

        yield* applyPlan(
          writes,
          yield* envPort.onLanded(
            { after: landed, before, now },
            snapshotNow(h, writes)
          ),
          now
        );

        if (row.policy === undefined || row.policyAt !== landed) {
          return;
        }

        const after = yield* Effect.orDie(decodePolicy(row.policy));

        yield* applyPlan(
          writes,
          yield* visibility.onPolicy(
            { after, before: h.policy, landings: writes.landings, now },
            snapshotNow(h, writes)
          ),
          now
        );
      });

    const afterLandings = (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
      Effect.andThen(followUp(h, writes, now), visibilityAfter(h, writes, now));

    const write = <A, E>(
      queue: AnswerQueue,
      body: (
        h: Hydrated,
        writes: Writes,
        now: DateTime.Utc
      ) => Effect.Effect<A, E>
    ): Effect.Effect<A, E> =>
      writeLocked(queue, (h, writes, now) =>
        Effect.tap(body(h, writes, now), () => afterLandings(h, writes, now))
      );

    const mainAt = (tip: CommitSha) =>
      Effect.gen(function* () {
        const empty = { fs: memoryFs(), gitdir: "/adopt.git" };

        yield* Effect.tryPromise(() => init({ ...empty, bare: true })).pipe(
          Effect.orDie
        );

        yield* host
          .push(repo, empty, [{ from: Option.none(), ref: mainRef, to: tip }])
          .pipe(
            Effect.mapError(
              () => new ImportFailed({ reason: "main could not be made" })
            )
          );
      });

    /**
     * The tip is `main`'s, else the named branch's, else the one branch the
     * import made.
     *
     * Runs only while the project has no row, so an existing repo is this
     * project's earlier import that died after Artifacts made it; it is waited
     * for and adopted. Assumes the retry names the same remote.
     */
    const adopt = (from: { readonly branch?: string; readonly url: string }) =>
      Effect.gen(function* () {
        const branch = Option.map(
          Option.fromUndefinedOr(from.branch),
          Schema.decodeOption(BranchName)
        );

        if (Option.exists(branch, Option.isNone)) {
          return yield* new ImportFailed({
            reason: `${from.branch} is no branch name`,
          });
        }

        const named = Option.flatten(branch);

        yield* host
          .importFrom(repo, { url: from.url, ...field("branch", named) })
          .pipe(
            Effect.catchTags({
              ImportRefused: ({ reason }) =>
                Effect.fail(
                  new ImportFailed({
                    reason: reason === "" ? "the import was refused" : reason,
                  })
                ),
              RepoExists: () => Effect.void,
            })
          );

        const refs = yield* host.refs(repo).pipe(Effect.orDie);

        const branches = [...refs].filter(([ref]) =>
          ref.startsWith("refs/heads/")
        );

        const tip = Option.firstSomeOf([
          Option.fromNullishOr(refs.get(mainRef)),
          Option.flatMap(named, (given) =>
            Option.fromNullishOr(refs.get(RefName.make(`refs/heads/${given}`)))
          ),
          Option.isNone(named) && branches.length === 1
            ? Option.fromNullishOr(branches[0]?.[1])
            : Option.none(),
        ]);

        if (Option.isNone(tip)) {
          return yield* new ImportFailed({
            reason: `${from.url} has no commits`,
          });
        }

        if (!refs.has(mainRef)) {
          yield* mainAt(tip.value);
        }

        return LandedSha.make(tip.value);
      });

    const runOf = (h: Hydrated, found: Answered): AnswerRun => {
      const { landing, verdict } = found.record;
      const { request } = landing;

      const ask = Option.flatMap(request.ask, (id) =>
        Option.fromUndefinedOr(h.asks.get(id))
      );

      const known = Option.all({ ask, policy: h.policy });

      const finish = Option.getOrElse(
        Option.flatMap(known, ({ ask: asked, policy }) =>
          Option.fromUndefinedOr(
            policy.kinds.find((kind) => kind.name === asked.kind)?.finish
          )
        ),
        (): AskKind["finish"] => "optional"
      );

      const askLane = Option.flatMap(known, ({ ask: asked, policy }) =>
        Option.map(askLaneOf(policy, asked), ({ lane }): LaneName => lane)
      );

      const judgedRun = Option.map(Option.fromUndefinedOr(verdict), (each) => ({
        message: messageOf(
          request,
          ask,
          each,
          heldBackTrailerOf(found.record, each.tree)
        ),
        verdict: each,
      }));

      return {
        admitted: holdsSlot(h.queue, request.requestId),
        finish,
        lanes: Option.getOrElse(
          Option.map(h.policy, (policy) => lanesOf(policy, ask)),
          () => []
        ),
        repo,
        state: landing,
        ...field("ask", ask),
        ...field("askLane", askLane),
        ...field(
          "counts",
          Option.map(h.policy, ({ modules, ratchets }) => ({
            modules,
            // An open migrate ask's callers are counted on every answer.
            ratchets: [
              ...ratchets,
              ...callersSpecs(h.asks.values()).filter(
                (spec) =>
                  !ratchets.some(({ name: named }) => named === spec.name)
              ),
            ],
          }))
        ),
        ...field(
          "run",
          Option.map(h.policy, ({ run }) => run)
        ),
        ...Option.getOrElse(judgedRun, () => ({})),
      };
    };

    const verdictFor = (input: {
      readonly ask: Ask;
      readonly checking: Checking;
      readonly heldBack: readonly HeldBackResult[];
      readonly lanes: readonly LaneResult[];
      readonly now: DateTime.Utc;
      readonly outcome: Outcome;
      readonly policy: Policy;
      readonly stage: StageName;
    }) =>
      Effect.gen(function* () {
        const { ask, checking, policy } = input;
        const { request } = checking;

        // `verdictOf` reads the ask, base and head; the rest stand as the
        // answer's merge left them.
        const facts: PushFacts = {
          addedLines: new Map(),
          ask: Option.some(ask),
          base: request.base,
          changes: checking.changes,
          claim: Option.none(),
          claimsHeld: 0,
          head: request.head,
          landed: checking.main,
          layerPaths: new Set(),
          opensAsk: false,
          policy,
          pusher: Person.make({ handle: request.answerer }),
          ref: RefNameText.make("refs/heads/main"),
          scriptsChanged: false,
          target: PushTarget.ClaimFork({
            ask: ask.id,
            claimant: request.answerer,
            project: name,
          }),
        };

        return yield* Effect.orDie(
          Effect.fromResult(
            verdictOf({
              checkVersion: checkVersion(
                ask.check,
                sdkVersion,
                policy.run,
                policy.ratchets
              ),
              facts,
              heldBack: input.heldBack,
              lanes: input.lanes,
              now: input.now,
              outcome: input.outcome,
              patchId: yield* patchId(checking.changes),
              stage: input.stage,
              tree: checking.tree,
            })
          )
        );
      });

    const answerClaim = (
      h: Hydrated,
      writes: Writes,
      ask: AskId,
      landing: { readonly answerer: Handle; readonly sha: LandedSha },
      now: DateTime.Utc
    ) =>
      Option.match(ownClaim(h, ask, landing.answerer), {
        onNone: () => Effect.void,
        onSome: ({ state }) =>
          Result.match(
            claimTransition(
              state,
              ClaimCommand.cases.Land.make({ landing: landing.sha }),
              now,
              claimsPolicy(h)
            ),
            {
              onFailure: () => Effect.void,
              onSuccess: (step) => applyClaim(h, writes, ask, step, now),
            }
          ),
      });

    const asksNow = (h: Hydrated, writes: Writes): ReadonlyMap<AskId, Ask> =>
      new Map([...h.asks, ...writes.asks]);

    const familyAfter = (
      h: Hydrated,
      writes: Writes,
      landed: AskId,
      at: { readonly now: DateTime.Utc; readonly sha: LandedSha }
    ) => {
      const parent = Option.flatMap(askNow(h, writes, landed), (ask) =>
        Option.fromUndefinedOr(ask.parent)
      );

      if (Option.isNone(parent)) {
        return;
      }

      const before = asksNow(h, writes);

      for (const child of before.values()) {
        if (
          child.parent === parent.value &&
          child.state === "waitingOnParent" &&
          remainingBlockers(child, before).length === 0
        ) {
          const opened: Ask = { ...child, state: "open" };

          writes.asks.set(child.id, opened);
          writes.events.push(askOpened(opened, at.now));
        }
      }

      const parentOpen = Option.filter(
        askNow(h, writes, parent.value),
        ({ state }) => state !== "closed"
      );

      if (
        Option.isSome(parentOpen) &&
        familyClosed(parent.value, asksNow(h, writes))
      ) {
        writes.asks.set(parent.value, { ...parentOpen.value, state: "closed" });
        writes.events.push(askClosed(parent.value, at.sha, at.now));
      }
    };

    const recordLanding = (
      h: Hydrated,
      writes: Writes,
      landing: Landing,
      landed: {
        readonly heldBack: Option.Option<string>;
        readonly sha: LandedSha;
        readonly verdict: Option.Option<Verdict>;
      },
      now: DateTime.Utc
    ) =>
      Effect.gen(function* () {
        const { request } = landing;
        const { sha } = landed;

        writes.landings.push({
          assisted: request.assisted,
          author: request.answerer,
          credits: request.credits,
          landedAt: now,
          parent: landing.main,
          project: name,
          requestId: request.requestId,
          sha,
          ...field("ask", request.ask),
          // The value alone: the web, the CLI and git notes add the key.
          ...field("heldBackTrailer", landed.heldBack),
          ...field("verdict", landedVerdict(landed.verdict, sha)),
        });

        if (Option.isSome(request.ask)) {
          const id = request.ask.value;
          const ask = askNow(h, writes, id);

          if (Option.isSome(ask)) {
            writes.asks.set(id, { ...ask.value, state: "closed" });
          }

          writes.events.push(askClosed(id, sha, now));

          yield* answerClaim(
            h,
            writes,
            id,
            { answerer: request.answerer, sha },
            now
          );

          familyAfter(h, writes, id, { now, sha });
        }

        const row = Option.orElse(
          Option.fromUndefinedOr(writes.project.get("row")),
          () => h.project
        );

        if (Option.isSome(row)) {
          writes.project.set(
            "row",
            yield* withPolicyAt({ ...row.value, landed: sha }, sha, now)
          );
        }
      });

    const settleEffect = (
      context: {
        readonly before: LandingState;
        readonly h: Hydrated;
        readonly now: DateTime.Utc;
        readonly record: AnswerRecord;
        readonly requestId: RequestId;
        readonly verdict: Option.Option<Verdict>;
        readonly writes: Writes;
      },
      settled: Settled,
      effect: LandingEffect
    ): Effect.Effect<Settled> => {
      const { before, h, now, record, requestId, verdict, writes } = context;
      const handed = { ...settled, steps: [...settled.steps, effect] };

      return LandingEffect.$match(effect, {
        Emit: ({ event }) =>
          Effect.sync(() => {
            writes.events.push(withVerdict(event, verdict));

            return settled;
          }),
        Land: () =>
          Effect.gen(function* () {
            const asked = askToLand(settled.queue, requestId);

            yield* startOther(writes, asked.admitted, requestId, now);

            return {
              queue: asked.queue,
              steps: holdsSlot(asked.queue, requestId)
                ? handed.steps
                : settled.steps,
            };
          }),
        Merge: () => Effect.succeed(handed),
        Record: ({ sha }) =>
          LandingState.guards.Landing(before)
            ? Effect.as(
                recordLanding(
                  h,
                  writes,
                  before,
                  {
                    heldBack: heldBackTrailerOf(record, before.tree),
                    sha,
                    verdict,
                  },
                  now
                ),
                settled
              )
            : Effect.succeed(settled),
        Retry: ({ at }) =>
          Effect.map(startRow(requestId, at), (row) => {
            writes.outbox.push(row);

            return handed;
          }),
        RunChecks: () => Effect.succeed(handed),
      });
    };

    const verdictAfter = (input: {
      readonly ask: Option.Option<Ask>;
      readonly before: LandingState;
      readonly command: LandingCommand;
      readonly h: Hydrated;
      readonly kept: Option.Option<Verdict>;
      readonly now: DateTime.Utc;
      readonly report: AnswerReport | undefined;
      readonly state: LandingState;
    }) => {
      const { before, command, state } = input;
      const known = Option.all({ ask: input.ask, policy: input.h.policy });

      if (
        !LandingCommand.$is("Checked")(command) ||
        !LandingState.guards.Checking(before) ||
        before.tree !== command.tree ||
        state === before ||
        Option.isNone(known)
      ) {
        return Effect.succeed({ fresh: false, verdict: input.kept });
      }

      return Effect.map(
        verdictFor({
          ask: known.value.ask,
          checking: before,
          heldBack: input.report?.heldBack ?? [],
          lanes: input.report?.lanes ?? [],
          now: input.now,
          outcome: outcomeOf(state),
          policy: known.value.policy,
          stage: command.refusals.length > 0 ? "checks" : "human",
        }),
        (made) => ({ fresh: true, verdict: Option.some(made) })
      );
    };

    const bookkeepingRow = (input: {
      readonly ask: Option.Option<Ask>;
      readonly heldBack: Option.Option<string>;
      readonly landing: Landing;
      readonly now: DateTime.Utc;
      readonly verdict: Verdict;
    }) => {
      const { request } = input.landing;

      return outboxRow(
        `bookkeeping:${request.requestId}`,
        OutboxBody.cases.Bookkeeping.make({
          job: {
            author: request.answerer,
            base: request.base,
            fork: request.fork,
            head: request.head,
            main: input.landing.main,
            message: messageOf(
              request,
              input.ask,
              input.verdict,
              input.heldBack
            ),
            repo,
            requestId: request.requestId,
            tree: input.landing.tree,
            verdict: input.verdict,
          },
        }),
        DateTime.addDuration(input.now, "1 second")
      );
    };

    const keepBooks = (input: {
      readonly ask: Option.Option<Ask>;
      readonly before: LandingState;
      readonly command: LandingCommand;
      readonly now: DateTime.Utc;
      readonly record: AnswerRecord;
      readonly report: AnswerReport | undefined;
      readonly verdict: Option.Option<Verdict>;
      readonly writes: Writes;
    }) => {
      const { before } = input;
      const pending = input.report?.pending ?? [];

      if (
        !LandingCommand.$is("LandedOk")(input.command) ||
        !LandingState.guards.Landing(before) ||
        pending.length === 0 ||
        Option.isNone(input.verdict)
      ) {
        return Effect.void;
      }

      return Effect.map(
        bookkeepingRow({
          ask: input.ask,
          heldBack: heldBackTrailerOf(input.record, before.tree),
          landing: before,
          now: input.now,
          verdict: input.verdict.value,
        }),
        (row) => input.writes.outbox.push(row)
      );
    };

    const ratchetJudged = (input: {
      readonly checking: Checking;
      readonly command: Data.TaggedEnum.Value<LandingCommand, "Checked">;
      readonly h: Hydrated;
      readonly now: DateTime.Utc;
      readonly report: AnswerReport | undefined;
      readonly waived: readonly Waiver[];
      readonly writes: Writes;
    }) =>
      Effect.gen(function* () {
        const { checking, command, h, now, writes } = input;
        const { request } = checking;
        const ask = Option.flatMap(request.ask, (id) => askNow(h, writes, id));
        const known = Option.all({ ask, policy: h.policy, row: h.project });

        if (Option.isNone(known)) {
          return { command, measured: Option.none<Measured>() };
        }

        const { ask: asked, policy } = known.value;
        const { initializer } = known.value.row;

        const escapeBaselines = new Map(
          ratchetsNow(h, writes)
            .filter(isEscapeRow)
            .map(({ count, ratchet }) => [ratchet, count])
        );

        const facts = yield* withPorts(
          pushFacts({
            ask,
            base: request.base,
            claim: Option.none(),
            claimsHeld: 0,
            head: request.head,
            landed: checking.main,
            policy,
            project: name,
            pusher: Person.make({ handle: request.answerer }),
            ref: mainRef,
            repo: request.fork,
          })
        ).pipe(
          Effect.tapError((unread) =>
            Effect.logWarning(
              `the lines of answer ${request.requestId} could not be read for its escapes`,
              unread
            )
          ),
          Effect.result
        );

        const waivers = Result.match(facts, {
          onFailure: (): readonly Waiver[] => [],
          onSuccess: (found) =>
            escapeDecisions({ ...found, ratchetBaselines: escapeBaselines }),
        });

        const unread = Result.isFailure(facts) ? [new VerifierBlocked({})] : [];

        const territoryIn = (waiver: Waiver) =>
          territoryOf(policy, asked, waiver.at.path);

        // A reasoned escape in a territory explains a raise there.
        const raises = explainedRaises(policy, asked, waivers);

        const declared = input.report?.ratchets ?? [];

        // A tree merged onto a main that has moved on since is not judged:
        // its counts still hold what later landings removed (a sibling
        // child's callers), which against the baselines those landings
        // lowered would read as a raise. It cannot land as it is: its land
        // finds main moved, and it is merged and checked again first.
        const current = Option.exists(
          liveRow(h),
          ({ landed }) => landed === checking.main
        );

        const judgement = current
          ? judgeRatchets({
              ask: asked.id,
              baselines: baselinesNow(h, writes),
              measured: declared,
              raises,
            })
          : { decisions: [], refusals: [] };

        const escapes = Array.dedupe(waivers.map(territoryIn)).map(
          (territory): MeasuredCount => {
            const ratchet = escapeRatchet(territory);

            return {
              count:
                (escapeBaselines.get(ratchet) ?? 0) +
                waivers.filter((waiver) => territoryIn(waiver) === territory)
                  .length,
              ratchet,
              territory,
            };
          }
        );

        const refusals = [
          ...command.refusals,
          ...unread,
          ...judgement.refusals,
        ];

        const asking = Array.isReadonlyArrayEmpty(refusals)
          ? [
              ...waivers.filter(
                (waiver) => !input.waived.some(sameEscape(waiver))
              ),
              ...judgement.decisions,
            ]
          : [];

        const changed = checking.changes.map(({ path }) => path);

        const pending = asking.map((subject): PendingDecision => {
          const decision = openDecision({
            deciders: decidersOn(
              policy,
              DecisionSubject.guards.Waiver(subject)
                ? [subject.at.path]
                : changed,
              initializer
            ),
            evidence: evidenceFor(request, subject),
            expireDays: policy.budget.expireDays,
            id: nextDecisionId(h.decisions, writes.decisions),
            now,
            project: name,
            subject,
          });

          writes.decisions.set(decision.id, decision);

          return { id: decision.id, subject };
        });

        return {
          command: LandingCommand.Checked({
            ...command,
            decisions: [...command.decisions, ...pending],
            refusals,
          }),
          measured: Option.some<Measured>({ declared, escapes }),
        };
      });

    const raiseOnDecision = (
      h: Hydrated,
      writes: Writes,
      decided: Option.Option<DecidedOn>
    ) => {
      const live = liveRow(h);

      if (Option.isNone(decided) || Option.isNone(live)) {
        return;
      }

      const { choice, subject } = decided.value;

      if (DecisionSubject.guards.RaiseRatchet(subject)) {
        putRatchets(
          h,
          writes,
          decideRaise(
            baselinesNow(h, writes),
            subject,
            choice,
            live.value.landed
          )
        );
      }
    };

    const ratchetsAtLanding = (
      h: Hydrated,
      writes: Writes,
      measured: Option.Option<Measured>,
      sha: LandedSha
    ) => {
      if (Option.isNone(measured)) {
        return;
      }

      const { declared, escapes } = measured.value;

      putRatchets(h, writes, [
        ...afterLanding(baselinesNow(h, writes), declared, sha).baselines,
        ...escapes.map(({ count, ratchet, territory }) => ({
          count,
          ratchet,
          setAt: sha,
          territory,
        })),
      ]);
    };

    const advanceBody =
      (requestId: RequestId, reported: LandingCommand, report?: AnswerReport) =>
      (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
        Effect.gen(function* () {
          const found = findAnswer(h, requestId);

          if (Option.isNone(found)) {
            return yield* Effect.die(`no answer request ${requestId}`);
          }

          const { record, row } = found.value;
          const before = record.landing;

          const counted =
            LandingCommand.$is("Checked")(reported) &&
            LandingState.guards.Checking(before) &&
            before.tree === reported.tree
              ? yield* ratchetJudged({
                  checking: before,
                  command: reported,
                  h,
                  now,
                  report,
                  waived: record.waived ?? [],
                  writes,
                })
              : { command: reported, measured: Option.none<Measured>() };

          const { command } = counted;
          const { effects, state } = landingTransition(before, command, now);
          const { request } = state;

          const measured = Option.orElse(counted.measured, () =>
            Option.fromUndefinedOr(record.measured)
          );

          const decided = decidedOn(before, command);
          const waived = waivedAfter(record.waived ?? [], decided);

          raiseOnDecision(h, writes, decided);

          if (
            LandingState.guards.Landed(state) &&
            LandingState.guards.Landing(before)
          ) {
            ratchetsAtLanding(h, writes, measured, state.sha);
          }

          const ask = Option.flatMap(request.ask, (id) =>
            askNow(h, writes, id)
          );

          const { fresh, verdict } = yield* verdictAfter({
            ask,
            before,
            command,
            h,
            kept: Option.fromUndefinedOr(record.verdict),
            now,
            report,
            state,
          });

          const refusedNow =
            LandingState.guards.Refused(state) &&
            !LandingState.guards.Refused(before);

          if (Option.isSome(request.ask) && (fresh || refusedNow)) {
            writes.events.push(
              judged(request.ask.value, request.head, outcomeOf(state), now)
            );
          }

          writes.outbox.push(
            ...(yield* answerPoints({
              before,
              command,
              now,
              project: name,
              queuedAt: record.queuedAt,
              report,
              requestId,
              state,
            }))
          );

          const settled = yield* Effect.reduce(
            effects,
            (): Settled => ({ queue: h.queue, steps: [] }),
            (each, effect) =>
              settleEffect(
                { before, h, now, record, requestId, verdict, writes },
                each,
                effect
              )
          );

          const queue = yield* leaveIfDone(writes, settled.queue, {
            now,
            requestId,
            state,
          });

          if (queue !== h.queue) {
            writes.queue.set("queue", queue);
          }

          yield* keepBooks({
            ask,
            before,
            command,
            now,
            record,
            report,
            verdict,
            writes,
          });

          if (state !== before || fresh) {
            writes.answers.set(requestId, {
              ...row,
              state: yield* Effect.orDie(
                encodeAnswer({
                  ...record,
                  landing: state,
                  ...field("verdict", verdict),
                  ...field("measured", measured),
                  ...field(
                    "waived",
                    Option.liftPredicate(waived, Array.isReadonlyArrayNonEmpty)
                  ),
                })
              ),
              updatedAt: now,
            });
          }

          return {
            effects: settled.steps.filter(runnable),
            outcome: outcomeOf(state),
          };
        });

    const landAdoption = (
      writes: Writes,
      author: Handle,
      sha: LandedSha,
      now: DateTime.Utc
    ) => {
      keepLanding(
        writes,
        {
          assisted: [],
          author,
          credits: [],
          landedAt: now,
          project: name,
          sha,
        },
        now
      );
    };

    const adoptionOf = (h: Hydrated, row: ProjectRow) =>
      Effect.gen(function* () {
        const kept = h.landings.find(({ parent }) => parent === undefined);

        if (kept !== undefined || row.landed === undefined) {
          return Option.fromNullishOr(kept);
        }

        let at = Option.some<CommitSha>(row.landed);

        while (Option.isSome(at)) {
          const found = yield* store.landing(at.value);

          if (Option.isNone(found)) {
            return Option.none<LandingView>();
          }

          if (found.value.parent === undefined) {
            return found;
          }

          at = Option.some<CommitSha>(found.value.parent);
        }

        return Option.none<LandingView>();
      });

    const keepSource = (
      caller: Person,
      from: ImportSource,
      row: ProjectRow,
      h: Hydrated,
      writes: Writes
    ) =>
      Effect.gen(function* () {
        const exists = new ProjectExists({ project: name });

        if (
          row.landed === undefined ||
          !sameHandle(row.initializer, caller.handle)
        ) {
          return yield* exists;
        }

        const answer = {
          landed: row.landed,
          project: name,
          remote: `${yield* GatewayUrl}/${name}.git`,
        };

        if (row.importedFrom !== undefined) {
          return sameSource(row.importedFrom, from) ? answer : yield* exists;
        }

        const adoption = yield* adoptionOf(h, row);

        if (
          Option.isNone(adoption) ||
          DateTime.toEpochMillis(adoption.value.landedAt) !==
            DateTime.toEpochMillis(row.createdAt)
        ) {
          return yield* exists;
        }

        writes.project.set("row", { ...row, importedFrom: from });

        return answer;
      });

    const initBody =
      (caller: Person, input: { readonly import?: ImportSource }) =>
      (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
        Effect.gen(function* () {
          if (Option.isSome(h.project)) {
            return input.import === undefined
              ? yield* new ProjectExists({ project: name })
              : yield* keepSource(
                  caller,
                  input.import,
                  h.project.value,
                  h,
                  writes
                );
          }

          // A project is made only in a namespace of one's own: the caller's
          // handle, or the source namespace the import's URL names.
          const owner = ownerOf(name);

          const mine = isSourceNamespace(owner)
            ? input.import !== undefined &&
              Option.contains(sourceNamespaceOf(input.import.url), owner)
            : owner === caller.handle.toLowerCase();

          if (!mine) {
            return yield* NotYourNamespace.of(name, caller.handle);
          }

          const remote = `${yield* GatewayUrl}/${name}.git`;

          const made: ProjectRow = {
            createdAt: now,
            initializer: caller.handle,
            project: name,
            state: "awaitingFirstPush",
          };

          if (input.import === undefined) {
            // A repo left by a call that failed after making it is this project's.
            yield* host
              .create(repo)
              .pipe(Effect.catchTag("RepoExists", () => Effect.void));

            writes.project.set("row", made);

            return { project: name, remote };
          }

          const landed = yield* adopt(input.import);

          landAdoption(writes, caller.handle, landed, now);
          writes.project.set(
            "row",
            yield* withPolicyAt(
              { ...made, importedFrom: input.import, landed, state: "live" },
              landed,
              now
            )
          );

          return { landed, project: name, remote };
        });

    const firstPushBody =
      (caller: Person, head: CommitSha) =>
      (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
        Effect.gen(function* () {
          const refused = new DirectPush({ ref: mainRef });
          const row = Option.getOrUndefined(h.project);

          if (
            row === undefined ||
            !sameHandle(row.initializer, caller.handle)
          ) {
            return yield* refused;
          }

          const landed = LandedSha.make(head);

          // The same first push again: still the project's adoption (the one
          // landing with no parent), whatever the platform landed on top of
          // it since, such as the regenerated contribute skill.
          if (row.state === "live") {
            const adopted = h.landings.some(
              ({ parent, sha }) => sha === landed && parent === undefined
            );

            return row.landed === landed || adopted
              ? { landed }
              : yield* refused;
          }

          landAdoption(writes, row.initializer, landed, now);
          writes.project.set(
            "row",
            yield* withPolicyAt({ ...row, landed, state: "live" }, landed, now)
          );

          return { landed };
        });

    const statedAsk = (input: {
      readonly composed: CommitSha;
      readonly id: AskId;
      readonly now: DateTime.Utc;
      readonly policy: Policy;
      readonly row: ProjectRow;
    }) =>
      Effect.gen(function* () {
        const { id, policy } = input;

        // The composed commit is never main; the evaluator reads it as it
        // would a landing, which is all the port knows how to name.
        const evaluated = yield* evaluateAt(
          input.row,
          LandedSha.make(input.composed),
          input.now
        );

        if (Option.isNone(evaluated)) {
          return yield* new VerifierBlocked({});
        }

        const stated = evaluated.value.asks.find((ask) => ask.id === id);

        if (stated === undefined) {
          return yield* new IncompleteBrief({ missing: ["want"] });
        }

        const kind = policy.kinds.find((each) => each.name === stated.kind);

        const missing =
          kind === undefined
            ? ["kind"]
            : kind.requires.filter((each) => !holds(stated, each));

        if (Array.isReadonlyArrayNonEmpty(missing)) {
          return yield* new IncompleteBrief({ missing });
        }

        return stated;
      });

    const touchedJudge = (input: {
      readonly ask: Ask;
      readonly caller: Person;
      readonly files: readonly AskFile[];
      readonly head: CommitSha;
      readonly main: LandedSha;
      readonly policy: Policy;
    }) =>
      Effect.map(
        scan.run({
          addedLines: new Map(),
          ask: Option.some(input.ask),
          base: input.main,
          changes: input.files.map(({ path }) => ({
            path,
            status: "added" as const,
          })),
          claim: Option.none(),
          claimsHeld: 0,
          head: input.head,
          landed: input.main,
          layerPaths: new Set(),
          opensAsk: true,
          policy: input.policy,
          pusher: input.caller,
          ref: RefNameText.make("refs/heads/main"),
          scriptsChanged: false,
          target: PushTarget.Canonical({ project: name }),
        }),
        (refusals) => Array.findFirst(refusals, isTouchedJudge)
      );

    const runTwice = (
      policy: Policy,
      ask: Ask,
      composed: CommitSha,
      watch: Watch
    ) =>
      Effect.gen(function* () {
        const lane = askCheckLane(policy, ask);

        if (Option.isNone(lane)) {
          return yield* new NotRedFirst({});
        }

        // The ask's files are unlanded code: they run with placeholders.
        const env = yield* envPort.runEnv(
          { landed: false },
          yield* store.load()
        );

        const job = {
          ...env,
          at: CheckAt.cases.Commit.make({ commit: composed }),
          lanes: [
            watch.stdout
              ? CheckLane.make({ ...lane.value, output: "stdout" })
              : lane.value,
          ],
          project: name,
          repo,
          run: policy.run,
        };

        const runs = [yield* runner.run(job), yield* runner.run(job)] as const;

        yield* watch.ran(lane.value.lane, runs);

        return { lane: lane.value.lane, runs };
      });

    const redTwice = (
      policy: Policy,
      ask: Ask,
      composed: CommitSha,
      watch: Watch
    ) =>
      Effect.gen(function* () {
        const { lane, runs } = yield* runTwice(policy, ask, composed, watch);

        if (CheckSpec.guards.LintToZero(ask.check)) {
          return yield* redByCount({
            ask,
            check: ask.check,
            lane,
            policy,
            runs,
          });
        }

        yield* Effect.fromResult(redFirstOfRuns(runs, lane));

        return [];
      });

    const callersTwice = (
      policy: Policy,
      ask: Ask,
      composed: CommitSha,
      watch: Watch
    ) =>
      Effect.gen(function* () {
        const { lane, runs } = yield* runTwice(policy, ask, composed, watch);

        const read = (run: CheckRun) =>
          Effect.fromOption(
            Option.flatMap(outputOf(run, lane), callerCountOf)
          ).pipe(Effect.mapError(() => new NotRedFirst({})));

        const [first, second] = runs;
        const once = yield* read(first);
        const again = yield* read(second);

        if (
          !sameCount(once, again) ||
          callersIn(ask.territory, once, policy.modules) === 0
        ) {
          return yield* new NotRedFirst({});
        }

        return once;
      });

    const takenBy = (
      h: Hydrated,
      writes: Writes,
      input: {
        readonly added: readonly ComposedFile[];
        readonly files: readonly AskFile[];
        readonly policy: Policy;
      }
    ) => {
      const held = new Set<string>([
        ...[...h.asks.values(), ...writes.asks.values()].map(
          ({ file }) => file
        ),
        ...input.policy.asks.map(({ file }) => file),
        ...input.files.map(({ path }) => path),
      ]);

      return input.added.flatMap(({ path }, at) =>
        held.has(path) ||
        input.added.findIndex((other) => other.path === path) !== at
          ? [path]
          : []
      );
    };

    const migrateOpening = (input: {
      readonly ask: Ask;
      readonly composed: { readonly commit: CommitSha; readonly tree: TreeSha };
      readonly files: Array.NonEmptyReadonlyArray<AskFile>;
      readonly h: Hydrated;
      readonly main: LandedSha;
      readonly policy: Policy;
      readonly watch: Watch;
      readonly writes: Writes;
    }) =>
      Effect.gen(function* () {
        const { ask, composed, files, policy } = input;

        const counts = yield* callersTwice(
          policy,
          ask,
          composed.commit,
          input.watch
        );

        const callers: readonly RatchetCount[] = CheckSpec.guards.Migrate(
          ask.check
        )
          ? [
              {
                count: counts.total,
                ratchet: callersRatchet(ask.check.from),
                territory: WHOLE_PROJECT,
              },
            ]
          : [];

        const family = splitFamily({
          configDir: Brand.configDir,
          counts,
          modules: policy.modules,
          parent: ask,
        });

        if (Option.isNone(family)) {
          return {
            asks: Array.make(ask),
            callers,
            children: [],
            counted: [],
            files,
            tree: composed.tree,
          };
        }

        const { children, deleteChild, parent } = family.value;
        const added = family.value.files;
        const taken = takenBy(input.h, input.writes, { added, files, policy });

        if (Array.isReadonlyArrayNonEmpty(taken)) {
          return yield* new TouchedJudge({ paths: taken });
        }

        const all = Array.appendAll(files, added);

        const { tree } = yield* lander.compose({
          files: all,
          main: input.main,
          repo,
        });

        return {
          asks: Array.make(parent, ...children, deleteChild),
          callers,
          children: [...children, deleteChild].map(({ id }) => id),
          counted: [],
          files: all,
          tree,
        };
      });

    const landAsk = (input: {
      readonly ask: Ask;
      readonly assisted: readonly AgentTrailer[];
      readonly children: readonly AskId[];
      readonly credits: readonly Credit[];
      readonly files: Array.NonEmptyReadonlyArray<ComposedFile>;
      readonly main: LandedSha;
      readonly tree: Checking["tree"];
    }) => {
      const requestId = RequestId.make(`open-${input.tree}`);
      const { children, credits } = input;

      const landing = lander
        .land({
          author: input.ask.askedBy,
          main: input.main,
          message: formatLanding({
            ask: { ask: input.ask.id, project: name },
            assisted: input.assisted,
            body:
              children.length === 0
                ? input.ask.brief.want
                : [
                    input.ask.brief.want,
                    "",
                    "Its child asks, the last waiting on the rest:",
                    ...children.map((child) => `- ${child}`),
                  ].join("\n"),
            credits,
            requestId,
            subject: `Open ask ${input.ask.id}`,
          }),
          rebuild: Rebuild.Compose({ files: input.files }),
          repo,
          requestId,
          tree: input.tree,
          verdict: Option.none(),
        })
        .pipe(
          Effect.catchTag("RepoBusy", () =>
            Effect.fail(new VerifierBlocked({}))
          )
        );

      return Effect.map(landing, ({ sha }) => ({ credits, requestId, sha }));
    };

    const prepareOpening = (
      h: Hydrated,
      writes: Writes,
      now: DateTime.Utc,
      opening: Opening,
      watch: Watch
    ) =>
      Effect.gen(function* () {
        const live = liveRow(h);
        const { decider } = opening;

        if (Option.isNone(live) || Option.isNone(h.policy)) {
          return yield* new VerifierBlocked({});
        }

        const policy = h.policy.value;

        if (!isDecider(policy, decider.handle)) {
          return yield* new NotDecider({});
        }

        // An ask still open (or claimed) is not opened twice: the same
        // call again finds it as it stands, and nothing lands.
        const stillOpen = Option.filter(
          askNow(h, writes, opening.ask),
          ({ state }) => state !== "closed"
        );

        if (Option.isSome(stillOpen)) {
          return decidesOn(policy, stillOpen.value, decider.handle)
            ? Result.fail({
                ask: stillOpen.value,
                landed: stillOpen.value.openedIn,
              })
            : yield* new NotDecider({});
        }

        const unplain = opening.files.flatMap(({ path }) =>
          isPlainPath(path) ? [] : [path]
        );

        if (Array.isReadonlyArrayNonEmpty(unplain)) {
          return yield* new TouchedJudge({ paths: unplain });
        }

        const { landed: main, row } = live.value;
        const { files } = opening;
        const composed = yield* lander.compose({ files, main, repo });

        const stated = yield* statedAsk({
          composed: composed.commit,
          id: opening.ask,
          now,
          policy,
          row,
        });

        if (!decidesOn(policy, stated, decider.handle)) {
          return yield* new NotDecider({});
        }

        const ask: Ask = {
          ...stated,
          askedBy: opening.asker,
          openedAt: now,
          project: name,
          state: "open",
        };

        const touched = yield* touchedJudge({
          ask,
          caller: decider,
          files,
          head: composed.commit,
          main,
          policy,
        });

        if (Option.isSome(touched)) {
          return yield* touched.value;
        }

        const weak = weakness(ask, files);

        if (Option.isSome(weak)) {
          return yield* new WeakCheck({ weakness: weak.value });
        }

        const opens = countsCallers(ask.check)
          ? yield* migrateOpening({
              ask,
              composed,
              files,
              h,
              main,
              policy,
              watch,
              writes,
            })
          : {
              asks: Array.make(ask),
              callers: [],
              children: [],
              counted: yield* redTwice(policy, ask, composed.commit, watch),
              files,
              tree: composed.tree,
            };

        return Result.succeed({ ask, main, opens, row });
      });

    const openFrom = (
      h: Hydrated,
      writes: Writes,
      now: DateTime.Utc,
      opening: Opening
    ) =>
      Effect.gen(function* () {
        const prepared = yield* prepareOpening(
          h,
          writes,
          now,
          opening,
          unwatched
        );

        if (Result.isFailure(prepared)) {
          return prepared.failure;
        }

        const { ask, main, opens, row } = prepared.success;

        const landed = yield* landAsk({
          ask,
          assisted: opening.assisted,
          children: opens.children,
          credits: opening.credits,
          files: opens.files,
          main,
          tree: opens.tree,
        });

        const opened = Array.map(opens.asks, (each): Ask => ({
          ...each,
          openedIn: landed.sha,
        }));

        for (const each of opened) {
          writes.asks.set(each.id, each);

          // A child that waits on others opens when they land.
          if (each.state === "open") {
            writes.events.push(askOpened(each, now));
          }
        }

        const landing: LandingView = {
          assisted: opening.assisted,
          author: opening.asker,
          credits: landed.credits,
          landedAt: now,
          opened: ask.id,
          parent: main,
          project: name,
          requestId: landed.requestId,
          sha: landed.sha,
        };

        // Heard as every landing is (main moved), so a list of landings
        // shows the opening; it answers no ask, so it credits nothing.
        keepLanding(writes, landing, now);
        writes.project.set(
          "row",
          yield* withPolicyAt({ ...row, landed: landed.sha }, landed.sha, now)
        );

        // The opening landing records the baselines its check's count read,
        // and sets a migrate ask's callers ratchet at its count: a lower
        // baseline a closed migrate ask of the same name left counted
        // nothing since, and while one is open no answer can raise it.
        putRatchets(h, writes, [
          ...afterLanding(baselinesNow(h, writes), opens.counted, landed.sha)
            .baselines,
          ...opens.callers.map(
            ({ count, ratchet, territory }): RatchetBaseline => ({
              count,
              ratchet,
              setAt: landed.sha,
              territory,
            })
          ),
        ]);

        return { ask: Array.headNonEmpty(opened), landed: landed.sha };
      });

    const openBody =
      (
        caller: Person,
        input: {
          readonly ask: AskId;
          readonly files: Array.NonEmptyReadonlyArray<AskFile>;
        }
      ) =>
      (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
        openFrom(h, writes, now, {
          ask: input.ask,
          asker: caller.handle,
          assisted: [],
          credits: [{ handle: caller.handle, role: "Asked-by" }],
          decider: caller,
          files: input.files,
        });

    const rehearse = (
      h: Hydrated,
      now: DateTime.Utc,
      files: readonly ConfigFile[]
    ) =>
      Effect.gen(function* () {
        const live = liveRow(h);

        if (Option.isNone(live) || Option.isNone(h.policy)) {
          return yield* new VerifierBlocked({});
        }

        const policy = h.policy.value;
        const ask = askIdOf(files);

        if (Option.isNone(ask) || !Array.isReadonlyArrayNonEmpty(files)) {
          return rehearsalRefused(
            new IncompleteBrief({ missing: ["want"] }),
            Option.none()
          );
        }

        const [first] = decidersOn(
          policy,
          pathsOf(
            policy,
            files.map(({ path }) => path),
            Option.none()
          ),
          live.value.row.initializer
        );

        const decider = Person.make({ handle: first });
        const seen = yield* Ref.make(Option.none<Seen>());

        const watch: Watch = {
          ran: (lane, runs) => Ref.set(seen, Option.some({ lane, runs })),
          stdout: true,
        };

        const refused = (refusal: FinalRefusal) =>
          Effect.map(Ref.get(seen), (runs): Rehearsal =>
            rehearsalRefused(refusal, runs)
          );

        return yield* prepareOpening(
          h,
          writesOf(),
          now,
          {
            ask: ask.value,
            asker: decider.handle,
            assisted: [],
            credits: [],
            decider,
            files,
          },
          watch
        ).pipe(
          Effect.flatMap((prepared) =>
            Result.match(prepared, {
              // An ask by that name is open: its file is the judge now.
              onFailure: (open) =>
                refused(new TouchedJudge({ paths: [open.ask.file] })),
              // Red first ran the check, so the watch saw it.
              onSuccess: ({ opens }) =>
                Effect.map(
                  Effect.orDie(
                    Effect.flatMap(Ref.get(seen), Effect.fromOption)
                  ),
                  (ran): Rehearsal =>
                    Rehearsal.cases.Red.make({
                      ...redOf(ran),
                      tree: opens.tree,
                    })
                ),
            })
          ),
          Effect.catchTags({
            IncompleteBrief: refused,
            NotDecider: refused,
            NotRedFirst: refused,
            TouchedJudge: refused,
            WeakCheck: refused,
          })
        );
      });

    const pathsAt = (at: LandedSha) => {
      const walk = (
        prefix: string,
        tree: ObjectId
      ): Effect.Effect<readonly RepoPath[]> =>
        Effect.flatMap(Effect.orDie(host.readTree(repo, tree)), (entries) =>
          Effect.map(
            Effect.forEach(
              Option.getOrElse(entries, (): readonly TreeEntry[] => []),
              ({ name: entry, sha, type }) =>
                type === "tree"
                  ? walk(`${prefix}${entry}/`, sha)
                  : Effect.succeed(
                      type === "blob"
                        ? [RepoPath.make(`${prefix}${entry}`)]
                        : []
                    )
            ),
            Array.flatten
          )
        );

      return Effect.flatMap(Effect.orDie(host.readCommit(repo, at)), (read) =>
        Option.match(read, {
          onNone: () => Effect.succeed([]),
          onSome: (landed) =>
            Effect.map(walk("", landed.tree), (paths) =>
              Array.sort(paths, Order.String).slice(0, MAX_DRAFT_PATHS)
            ),
        })
      );
    };

    const draftContextOf = (proposal: ProposalId, round: number) =>
      Effect.gen(function* () {
        const h = yield* hydrate;
        const found = Array.findFirst(h.proposals, ({ id }) => id === proposal);

        const live = Option.all({
          policy: h.policy,
          row: liveRow(h),
          wanted: found,
        });

        if (Option.isNone(live)) {
          return yield* new UnknownProposal({ proposal });
        }

        const { policy, row, wanted } = live.value;

        if (wanted.state !== "open") {
          return yield* new ProposalClosed({ proposal });
        }

        return {
          at: row.landed,
          paths: yield* pathsAt(row.landed),
          policy: publicPolicy(policy),
          project: name,
          proposal,
          round,
          ...field("territory", Option.fromUndefinedOr(wanted.territory)),
          want: wanted.want,
        };
      });

    const trustOf = (
      h: Hydrated,
      policy: Policy,
      ask: Ask,
      input: { readonly caller: Person; readonly now: DateTime.Utc }
    ) => {
      const { handle } = input.caller;
      const kind = policy.kinds.find((each) => each.name === ask.kind);
      const who = standing(policy, [], handle);

      const record = recordOf({
        asks: h.asks,
        landings: h.landings,
        now: input.now,
        policy: policy.record,
        reverted: new Set(),
      })(handle);

      const landingsInProject = h.landings.filter(({ author }) =>
        sameHandle(author, handle)
      ).length;

      const admitted =
        kind !== undefined &&
        Result.isSuccess(
          mayClaim({
            ask,
            kind,
            landingsInProject,
            policy,
            record,
            standing: who,
          })
        );

      return {
        denounced: who === "denounced",
        race: kind?.race ?? 1,
        standing: who,
        vouched: admitted,
      };
    };

    const claimBody =
      (caller: Person, id: AskId) =>
      (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
        Effect.gen(function* () {
          const ask = askNow(h, writes, id);
          const live = liveRow(h);

          if (
            Option.isNone(ask) ||
            Option.isNone(h.policy) ||
            Option.isNone(live)
          ) {
            return yield* new UnknownAsk({ ask: id });
          }

          const policy = h.policy.value;

          if (ask.value.state === "closed") {
            return yield* new AskFull({ ask: id });
          }

          const trust = trustOf(h, policy, ask.value, { caller, now });

          const command = ClaimCommand.cases.Claim.make({
            base: live.value.landed,
            blockedBy: remainingBlockers(ask.value, h.asks),
            cap: capFor(trust.standing, policy.caps.claimsPerPerson),
            denounced: trust.denounced,
            heldByWho: heldBy(h, caller.handle, id),
            liveCount: h.claims.filter(
              ({ row, state }) =>
                row.ask === id &&
                isLive(state) &&
                !sameHandle(row.claimant, caller.handle)
            ).length,
            project: name,
            race: trust.race,
            vouched: trust.vouched,
            who: caller,
          });

          const from = Option.match(ownClaim(h, id, caller.handle), {
            onNone: () => ClaimState.cases.Open.make({ ask: id }),
            onSome: ({ state }) => state,
          });

          const step = yield* Effect.fromResult(
            claimTransition(from, command, now, policy.claims)
          ).pipe(
            Effect.catchTags({
              ClaimLapsed: (refused) => Effect.die(refused),
              NotClaimed: (refused) => Effect.die(refused),
            })
          );

          // A claim granted anew discloses only the agents its own pushes
          // name, and is judged by the held-back suite sealed now.
          if (step.effects.length > 0) {
            yield* applyClaim(
              h,
              writes,
              id,
              step,
              now,
              [],
              visibility.pinSuite(
                { ask: id, claimant: caller.handle },
                snapshotNow(h, writes)
              )
            );
          }

          const view = yield* viewOf(
            h.policy,
            ask,
            step.state,
            claimRowNow(h, writes, id, caller.handle)?.pinned
          );

          return yield* Option.match(view, {
            onNone: () => Effect.die("a granted claim has no view"),
            onSome: (claim) => Effect.succeed({ claim }),
          });
        });

    const releaseBody =
      (caller: Person, id: AskId) =>
      (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
        Effect.gen(function* () {
          const own = ownClaim(h, id, caller.handle);

          if (Option.isNone(own)) {
            return yield* NotClaimed.of(id);
          }

          const step = yield* Effect.fromResult(
            claimTransition(
              own.value.state,
              ClaimCommand.cases.Release.make({ who: caller.handle }),
              now,
              claimsPolicy(h)
            )
          ).pipe(
            Effect.catchTags({
              AskBlocked: (refused) => Effect.die(refused),
              AskFull: (refused) => Effect.die(refused),
              CapReached: (refused) => Effect.die(refused),
              ClaimLapsed: (refused) => Effect.die(refused),
              Denounced: (refused) => Effect.die(refused),
              NotVouched: (refused) => Effect.die(refused),
            })
          );

          if (step.effects.length > 0) {
            yield* applyClaim(h, writes, id, step, now);
          }

          return { released: step.effects.length > 0 };
        });

    const keepAlive = (
      h: Hydrated,
      writes: Writes,
      input: {
        readonly claimed: Option.Option<Claimed>;
        readonly push: PushReport;
      },
      now: DateTime.Utc
    ) => {
      const { pusher } = input.push;

      const own = Option.filter(
        input.claimed,
        ({ row }) =>
          Principal.guards.Person(pusher) &&
          sameHandle(pusher.handle, row.claimant)
      );

      return Option.match(own, {
        onNone: () => Effect.void,
        onSome: ({ row, state }) =>
          Result.match(
            claimTransition(
              state,
              ClaimCommand.cases.Push.make({
                head: input.push.after,
                who: row.claimant,
              }),
              now,
              claimsPolicy(h)
            ),
            {
              onFailure: () => Effect.void,
              onSuccess: (step) =>
                applyClaim(
                  h,
                  writes,
                  row.ask,
                  step,
                  now,
                  withAgent(
                    claimRowNow(h, writes, row.ask, row.claimant)?.assisted ??
                      [],
                    input.push.audit
                  )
                ),
            }
          ),
      });
    };

    const strayOn = (
      h: Hydrated,
      writes: Writes,
      input: { readonly landed: LandedSha; readonly push: PushReport },
      now: DateTime.Utc
    ) =>
      Effect.gen(function* () {
        const { after, before, ref } = input.push;
        const row = Option.getOrUndefined(h.project);

        if (
          row === undefined ||
          Option.isNone(h.policy) ||
          input.push.repo !== repo ||
          ref !== mainRef ||
          after === input.landed
        ) {
          return;
        }

        if (Option.isSome(yield* store.landing(after))) {
          return;
        }

        const decision = strayDecision({
          after,
          before,
          id: nextDecisionId(h.decisions, writes.decisions),
          initializer: row.initializer,
          now,
          policy: h.policy.value,
          project: name,
        });

        writes.decisions.set(decision.id, decision);
      });

    const pushBody =
      (input: PushReport) => (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
        Effect.gen(function* () {
          const live = liveRow(h);

          if (Option.isNone(live) || Option.isNone(h.policy)) {
            return [];
          }

          const target = targetOf(input.repo, name);

          const fork = PushTarget.$is("ClaimFork")(target)
            ? Option.some(target)
            : Option.none();

          const ask = Option.flatMap(fork, (on) => askNow(h, writes, on.ask));

          const claimed = Option.flatMap(fork, (on) =>
            ownClaim(h, on.ask, on.claimant)
          );

          const view = yield* Option.match(claimed, {
            onNone: () => Effect.succeedNone,
            onSome: ({ row, state }) =>
              viewOf(h.policy, ask, state, row.pinned),
          });

          const claimBase = Option.getOrElse(
            Option.map(
              Option.flatMap(claimed, ({ state }) => claimOf(state)),
              (claim) => claim.base
            ),
            () => live.value.landed
          );

          // A fork the host lacks keeps the claim's base; the facts refuse it.
          const base = yield* withPorts(
            answerBase({
              base: claimBase,
              canonical: repo,
              head: input.after,
              landed: live.value.landed,
              repo: input.repo,
            })
          ).pipe(
            Effect.catchTag("RepoNotFound", () => Effect.succeed(claimBase))
          );

          const refused = yield* gateOf(
            withLayerFacts(
              h,
              writes,
              pushFacts({
                ask,
                base,
                claim: view,
                claimsHeld:
                  Principal.guards.Person(input.pusher) &&
                  capped(standing(h.policy.value, [], input.pusher.handle))
                    ? heldBy(h, input.pusher.handle)
                    : 0,
                head: input.after,
                landed: live.value.landed,
                policy: h.policy.value,
                project: name,
                pusher: input.pusher,
                ref: input.ref,
                repo: input.repo,
              })
            ),
            Option.match(fork, {
              onNone: () => [],
              onSome: (on) => [NotClaimed.of(on.ask)],
            }),
            [new StaleBase({ base, conflicts: [], main: live.value.landed })]
          );

          yield* keepAlive(h, writes, { claimed, push: input }, now);
          yield* strayOn(
            h,
            writes,
            { landed: live.value.landed, push: input },
            now
          );

          writes.pushEvents.push({
            after: input.after,
            at: now,
            eventId: input.eventId,
            ref: input.ref,
            repo: input.repo,
            ...field("before", input.before),
          });

          // The store keeps no push event twice, so a push heard again counts nothing.
          writes.outbox.push(
            ...(yield* measuredRow(
              `pushed:${input.eventId}`,
              Option.match(refused, {
                onNone: () => [],
                onSome: ({ refusals, stage }) =>
                  refusedPoints(name, stage, refusals),
              }),
              now
            ))
          );

          return Option.match(refused, {
            onNone: (): readonly Refusal[] => [],
            onSome: ({ refusals }) => refusals,
          });
        });

    /** A request id another person's answer holds is not the caller's to replay: `NotClaimed`. */
    const earlier = (
      h: Hydrated,
      caller: Person,
      input: {
        readonly ask: AskId;
        readonly head: CommitSha;
        readonly requestId: RequestId;
      }
    ): Effect.Effect<Option.Option<AnswerReceipt>, NotClaimed> => {
      const own = (row: AnswerRow) => sameHandle(row.answerer, caller.handle);
      const same = findAnswer(h, input.requestId);

      if (Option.isSome(same) && !own(same.value.row)) {
        return Effect.fail(NotClaimed.of(input.ask));
      }

      const given = Option.orElse(same, () =>
        Option.fromUndefinedOr(
          h.answers.find(
            ({ record, row }) =>
              row.ask === input.ask &&
              row.head === input.head &&
              own(row) &&
              !LandingState.guards.Refused(record.landing)
          )
        )
      );

      return Effect.succeed(Option.map(given, ({ record }) => record.receipt));
    };

    const queueAnswer = (
      writes: Writes,
      request: Request,
      input: {
        readonly ask: AskId;
        readonly main: LandedSha;
        readonly now: DateTime.Utc;
      }
    ) =>
      Effect.gen(function* () {
        const started = landingTransition(
          LandingState.cases.Queued.make({ request }),
          LandingCommand.Start({ main: input.main }),
          input.now
        );

        const receipt: AnswerReceipt = {
          ask: input.ask,
          base: request.base,
          head: request.head,
          outcome: outcomeOf(started.state),
          project: name,
          requestId: request.requestId,
        };

        writes.answers.set(request.requestId, {
          answerer: request.answerer,
          head: request.head,
          requestId: request.requestId,
          state: yield* Effect.orDie(
            encodeAnswer({
              landing: started.state,
              queuedAt: input.now,
              receipt,
            })
          ),
          updatedAt: input.now,
          ...field("ask", request.ask),
        });
        writes.outbox.push(yield* startRow(request.requestId, input.now));

        return receipt;
      });

    const submitBody =
      (
        caller: Person,
        input: {
          readonly ask: AskId;
          readonly base: CommitSha;
          readonly head: CommitSha;
          readonly requestId: RequestId;
        }
      ) =>
      (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
        Effect.gen(function* () {
          const given = yield* earlier(h, caller, input);

          if (Option.isSome(given)) {
            return given.value;
          }

          const refused = NotClaimed.of(input.ask);
          const ask = askNow(h, writes, input.ask);
          const live = liveRow(h);

          if (
            Option.isNone(ask) ||
            Option.isNone(live) ||
            Option.isNone(h.policy)
          ) {
            return yield* refused;
          }

          const own = ownClaim(h, input.ask, caller.handle);

          const fork = Option.getOrElse(
            Option.map(
              Option.flatMap(own, ({ state }) => claimOf(state)),
              (held) => held.fork
            ),
            () => claimForkName(name, input.ask, caller.handle)
          );

          const view = yield* Option.match(own, {
            onNone: () => Effect.succeedNone,
            onSome: ({ row, state }) =>
              viewOf(h.policy, ask, state, row.pinned),
          });

          // The base given is where the answer left main (the gateway gives
          // the claim's); it is judged from the newest landing its head
          // contains since, so the same change keeps the same patch id.
          const base = yield* withPorts(
            answerBase({
              base: input.base,
              canonical: repo,
              head: input.head,
              landed: live.value.landed,
              repo: fork,
            })
          ).pipe(Effect.catchTag("RepoNotFound", () => Effect.fail(refused)));

          const facts = yield* withLayerFacts(
            h,
            writes,
            pushFacts({
              ask,
              base,
              claim: view,
              claimsHeld: heldBy(h, caller.handle),
              head: input.head,
              landed: live.value.landed,
              policy: h.policy.value,
              project: name,
              pusher: caller,
              ref: mainRef,
              repo: fork,
            })
          ).pipe(
            Effect.catchTags({
              MissingCommit: () =>
                Effect.fail(
                  new StaleBase({
                    base,
                    conflicts: [],
                    main: live.value.landed,
                  })
                ),
              RepoNotFound: () => Effect.fail(refused),
            })
          );

          const gate = yield* runGate(pushStages, facts);

          if (Option.isSome(gate)) {
            return yield* submitRefusal(
              Array.headNonEmpty(gate.value),
              input.ask
            );
          }

          return yield* queueAnswer(
            writes,
            {
              answerer: caller.handle,
              ask: Option.some(input.ask),
              assisted: disclosed(
                h.policy.value,
                Option.map(own, ({ row }) => row)
              ),
              base,
              credits: creditsFor(ask.value, caller.handle),
              fork,
              head: input.head,
              project: name,
              requestId: input.requestId,
            },
            { ask: input.ask, main: live.value.landed, now }
          );
        });

    const tickAll = (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
      Effect.forEach(
        h.claims.filter(({ state }) => isLive(state)),
        ({ row, state }) =>
          Result.match(
            claimTransition(
              state,
              ClaimCommand.cases.Tick.make({}),
              now,
              claimsPolicy(h)
            ),
            {
              onFailure: () => Effect.void,
              onSuccess: (step) =>
                step.effects.length > 0
                  ? applyClaim(h, writes, row.ask, step, now)
                  : Effect.void,
            }
          ),
        { discard: true }
      );

    const statusOf = (caller: Person) =>
      Effect.gen(function* () {
        const h = yield* hydrate;

        const claims = yield* Effect.forEach(
          h.claims.filter(({ row }) => sameHandle(row.claimant, caller.handle)),
          ({ row, state }) =>
            viewOf(
              h.policy,
              Option.fromUndefinedOr(h.asks.get(row.ask)),
              state,
              row.pinned
            )
        );

        const answers = h.answers.flatMap(({ record, row }): AnswerView[] =>
          row.ask === undefined || !sameHandle(row.answerer, caller.handle)
            ? []
            : [
                {
                  ask: row.ask,
                  at: row.updatedAt,
                  head: row.head,
                  outcome: outcomeOf(record.landing),
                  requestId: row.requestId,
                },
              ]
        );

        return { answers, claims: Array.getSomes(claims) };
      });

    const verdictOn = (input: {
      readonly ask: AskId;
      readonly head?: CommitSha;
    }) =>
      Effect.flatMap(hydrate, (h) => {
        if (!h.asks.has(input.ask)) {
          return Effect.fail(new UnknownAsk({ ask: input.ask }));
        }

        const latest = Array.last(
          Array.sort(
            h.answers.filter(
              ({ record, row }) =>
                row.ask === input.ask &&
                record.verdict !== undefined &&
                (input.head === undefined || row.head === input.head)
            ),
            byUpdated
          )
        );

        const verdict = Option.flatMap(latest, ({ record }) =>
          Option.map(Option.fromUndefinedOr(record.verdict), (made) => ({
            ...made,
            outcome: outcomeOf(record.landing),
          }))
        );

        return Effect.succeed(field("verdict", verdict));
      });

    /** `NotDecider` comes before the log lookup, so the reply never tells which logs exist. */
    const evidenceOf = (caller: Principal, ref: LogRef) =>
      Effect.gen(function* () {
        const named = logOfRef(ref);

        if (Option.isNone(named) || named.value.project !== name) {
          return yield* new UnknownProject({
            project: Option.match(named, {
              onNone: () => name,
              onSome: ({ project }) => project,
            }),
          });
        }

        const { lane, requestId } = named.value;
        const h = yield* hydrate;

        const allowed = Principal.match(caller, {
          Anonymous: () => false,
          Person: ({ handle }) =>
            Option.exists(h.policy, (policy) => isDecider(policy, handle)) ||
            Option.exists(findAnswer(h, requestId), ({ row }) =>
              sameHandle(row.answerer, handle)
            ),
        });

        if (!allowed) {
          return yield* new NotDecider({});
        }

        const kept = yield* EvidenceStore.use((logs) => logs.get(ref));

        if (Option.isNone(kept)) {
          return yield* new UnknownProject({ project: name });
        }

        return { lane, ...tailOf(kept.value) };
      });

    const unlandedEnv = Effect.flatMap(hydrate, (h) =>
      envPort.runEnv({ landed: false }, h.snapshot)
    );

    const pinnedClaimOf = (h: Hydrated, record: AnswerRecord) => {
      const { request } = record.landing;

      return Option.flatMap(request.ask, (ask) =>
        Option.flatMap(ownClaim(h, ask, request.answerer), ({ row }) =>
          Option.map(Option.fromUndefinedOr(row.pinned), (pinned) => ({
            ask,
            claimant: row.claimant,
            pinned,
          }))
        )
      );
    };

    const answerOf = (requestId: RequestId) =>
      Effect.gen(function* () {
        const h = yield* hydrate;
        const found = findAnswer(h, requestId);

        if (Option.isNone(found)) {
          return Option.none<AnswerRun>();
        }

        const env = yield* envPort.runEnv({ landed: false }, h.snapshot);
        const sealed = Option.isSome(pinnedClaimOf(h, found.value.record));

        return Option.some<AnswerRun>({
          ...runOf(h, found.value),
          env,
          ...(sealed && { sealed }),
        });
      });

    const heldBackJobOf = (requestId: RequestId) =>
      Effect.gen(function* () {
        const h = yield* hydrate;

        const claim = Option.flatMap(findAnswer(h, requestId), ({ record }) =>
          pinnedClaimOf(h, record)
        );

        return Option.isNone(claim)
          ? Option.none<HeldBackJob>()
          : yield* visibility.heldBackJob(claim.value, h.snapshot);
      });

    const heldBackBody =
      (requestId: RequestId, results: readonly HeldBackResult[]) =>
      (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
        Effect.gen(function* () {
          const found = findAnswer(h, requestId);

          if (Option.isNone(found)) {
            return [];
          }

          const { record, row } = found.value;
          const { landing } = record;

          if (!LandingState.guards.Checking(landing)) {
            return [];
          }

          if (record.heldBack?.tree === landing.tree) {
            return record.heldBack.refusals;
          }

          const claim = pinnedClaimOf(h, record);

          if (Option.isNone(claim)) {
            return [];
          }

          const judgement = visibility.judgeHeldBack(
            { ...claim.value, now, requestId, results },
            snapshotNow(h, writes)
          );

          yield* absorb(writes, judgement.writes);

          const heldBack: HeldBackJudged = {
            refusals: judgement.refusals,
            tree: landing.tree,
            ...field(
              "trailer",
              Option.filter(judgement.trailer, (value) => value.length > 0)
            ),
          };

          writes.answers.set(requestId, {
            ...row,
            state: yield* Effect.orDie(encodeAnswer({ ...record, heldBack })),
            updatedAt: now,
          });

          return judgement.refusals;
        });

    const layerFactsOf = (caller: Principal) =>
      Effect.gen(function* () {
        const h = yield* hydrate;
        const paths = yield* visibility.layerPaths(h.snapshot);

        return {
          canRead: readsEveryLayer(caller, h.snapshot),
          layerPaths: [...paths],
        };
      });

    const envSchemaOf = Effect.gen(function* () {
      const h = yield* hydrate;

      const landed = Option.flatMap(h.project, ({ landed: at }) =>
        Option.fromUndefinedOr(at)
      );

      if (Option.isNone(landed)) {
        return yield* new UnknownProject({ project: name });
      }

      const read = yield* envPort.view(landed.value, h.snapshot);

      return { ...read, at: landed.value, project: name };
    });

    const setEnvBody =
      (caller: Person, input: Parameters<ProjectApi["setEnv"]>[1]) =>
      (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
        Effect.gen(function* () {
          const set = yield* envPort.set(
            {
              acknowledgeShort: input.acknowledgeShort ?? false,
              by: caller,
              key: input.key,
              now,
              value: input.value,
            },
            snapshotNow(h, writes)
          );

          yield* absorb(writes, set.writes);

          return set.result;
        });

    const planned =
      (
        plan: (
          snapshot: ProjectSnapshot,
          now: DateTime.Utc
        ) => Effect.Effect<VisibilityPlan>
      ) =>
      (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
        Effect.flatMap(plan(snapshotNow(h, writes), now), (made) =>
          applyPlan(writes, made, now)
        );

    const decided = deciders<Hydrated, Writes>({
      advance: (h, writes, now, requestId, command) =>
        advanceBody(requestId, command)(h, writes, now),
      enqueue: queueAnswer,
      name,
      open: openFrom,
      policyAt: withPolicyAt,
      read: hydrate,
      remote: (fork) =>
        Effect.gen(function* () {
          return `${yield* GatewayUrl}/${Option.getOrElse(addressOfRepo(fork), () => fork)}.git`;
        }),
      repo,
      runEnv: unlandedEnv,
      withLayers: (facts) =>
        Effect.flatMap(hydrate, (h) => layered(h.snapshot, facts)),
      withPorts,
      write,
    });

    const alarmed = (queue: AnswerQueue) =>
      Effect.gen(function* () {
        const rows = yield* lock.withPermits(1)(
          Effect.gen(function* () {
            const h = yield* hydrate;
            const now = yield* DateTime.now;
            const writes = writesOf();

            yield* tickAll(h, writes, now);
            yield* decided.expire(h, writes, now);
            // A decision that took its default may have landed (a revert).
            yield* afterLandings(h, writes, now);

            return [...(yield* commit(h, writes, now)), ...h.outbox];
          })
        );

        yield* settle(queue, rows);
      });

    const api: ProjectApi = {
      [envSchemaMethod]: (caller) =>
        checked(MethodSchemas[envSchemaMethod], [caller], envSchemaOf),
      admissionPlan: (input) =>
        checked(
          MethodSchemas.admissionPlan,
          [input],
          Effect.flatMap(hydrate, (h) =>
            visibility.admissionPlan(input, h.snapshot)
          )
        ),
      advanceAnswer: (requestId, command, report) =>
        checked(
          MethodSchemas.advanceAnswer,
          [requestId, command, report],
          write(api, advanceBody(requestId, command, report))
        ),
      answer: (requestId) =>
        checked(MethodSchemas.answer, [requestId], answerOf(requestId)),
      claim: (caller, id) =>
        checked(
          MethodSchemas.claim,
          [caller, id],
          write(api, claimBody(caller, id))
        ),
      credits: (caller, handle) =>
        checked(
          MethodSchemas.credits,
          [caller, handle],
          decided.credits(handle)
        ),
      decide: (caller, input) =>
        checked(
          MethodSchemas.decide,
          [caller, input],
          decided.decide(api, caller, input)
        ),
      draftAsk: (caller, input) =>
        checked(
          MethodSchemas.draftAsk,
          [caller, input],
          decided.draftAsk(api, caller, input)
        ),
      draftContext: (proposal, round) =>
        checked(
          MethodSchemas.draftContext,
          [proposal, round],
          draftContextOf(proposal, round)
        ),
      draftSettled: (proposal, round, result) =>
        checked(
          MethodSchemas.draftSettled,
          [proposal, round, result],
          decided.draftSettled(api, { proposal, result, round })
        ),
      events: (since, limit) =>
        checked(
          MethodSchemas.events,
          [since, limit],
          Effect.map(store.eventsSince(since, limit), (rows) =>
            rows.map(({ event, seq }) => ({ event, seq }))
          )
        ),
      evidence: (caller, ref) =>
        checked(MethodSchemas.evidence, [caller, ref], evidenceOf(caller, ref)),
      finish: (caller, input) =>
        checked(
          MethodSchemas.finish,
          [caller, input],
          decided.finish(api, caller, input)
        ),
      firstPusher: () =>
        checked(
          MethodSchemas.firstPusher,
          [],
          Effect.map(hydrate, (h) =>
            Option.flatMap(h.project, (row) =>
              row.state === "awaitingFirstPush"
                ? Option.some(row.initializer)
                : Option.none()
            )
          )
        ),
      flagAsk: (caller, input) =>
        checked(
          MethodSchemas.flagAsk,
          [caller, input],
          decided.flagAsk(api, caller, input)
        ),
      fork: (caller) =>
        checked(MethodSchemas.fork, [caller], decided.fork(api, caller)),
      forks: () =>
        checked(
          MethodSchemas.forks,
          [],
          Effect.map(hydrate, (h) =>
            Array.getSomes(h.claims.map(({ state }) => forkOf(state)))
          )
        ),
      head: () =>
        checked(
          MethodSchemas.head,
          [],
          Effect.map(hydrate, (h) =>
            Option.match(
              Option.flatMapNullishOr(h.project, ({ landed }) => landed),
              { onNone: () => ({}), onSome: (landed) => ({ landed }) }
            )
          )
        ),
      heldBackJob: (requestId) =>
        checked(
          MethodSchemas.heldBackJob,
          [requestId],
          heldBackJobOf(requestId)
        ),
      initProject: (caller, input) =>
        checked(
          MethodSchemas.initProject,
          [caller, input],
          write(api, initBody(caller, input))
        ),
      land: (caller, input) =>
        checked(
          MethodSchemas.land,
          [caller, input],
          decided.land(api, caller, input)
        ),
      landing: (caller, sha) =>
        checked(
          MethodSchemas.landing,
          [caller, sha],
          Effect.flatMap(store.landing(sha), (found) =>
            Option.match(found, {
              onNone: () => Effect.fail(new UnknownCommit({ sha })),
              onSome: (landing) =>
                Effect.map(withOpened([landing]), ([named = landing]) => ({
                  landing: named,
                })),
            })
          )
        ),
      landingCount: () =>
        checked(MethodSchemas.landingCount, [], store.landingCount()),
      landings: (shas) =>
        checked(
          MethodSchemas.landings,
          [shas],
          Effect.flatMap(
            Effect.forEach(Array.dedupe(shas), (sha) => store.landing(sha)),
            (found) => withOpened(Array.getSomes(found))
          )
        ),
      layerAccess: (caller, layer) =>
        checked(
          MethodSchemas.layerAccess,
          [caller, layer],
          Effect.map(hydrate, (h) =>
            visibility.access(caller, layer, h.snapshot)
          )
        ),
      layerFacts: (caller) =>
        checked(MethodSchemas.layerFacts, [caller], layerFactsOf(caller)),
      ledger: (caller) =>
        checked(
          MethodSchemas.ledger,
          [caller],
          Effect.map(hydrate, (h) => visibility.ledger(name, h.snapshot))
        ),
      listAsks: (caller) =>
        checked(
          MethodSchemas.listAsks,
          [caller],
          Effect.map(hydrate, (h) => ({
            asks: [...h.asks.values()].flatMap((ask) =>
              ask.state === "closed" ? [] : [listingOf(ask)]
            ),
          }))
        ),
      onAlarm: () => checked(MethodSchemas.onAlarm, [], alarmed(api)),
      openAsk: (caller, input) =>
        checked(
          MethodSchemas.openAsk,
          [caller, input],
          write(api, openBody(caller, input))
        ),
      policy: () => checked(MethodSchemas.policy, [], policyStatus),
      proposeAsk: (caller, input) =>
        checked(
          MethodSchemas.proposeAsk,
          [caller, input],
          decided.proposeAsk(api, caller, input)
        ),
      recordAdmission: (input) =>
        checked(
          MethodSchemas.recordAdmission,
          [input],
          write(
            api,
            planned((snapshot, now) =>
              visibility.onAdmission({ ...input, now }, snapshot)
            )
          )
        ),
      recordFirstPush: (caller, head) =>
        checked(
          MethodSchemas.recordFirstPush,
          [caller, head],
          write(api, firstPushBody(caller, head))
        ),
      recordHeldBack: (requestId, results) =>
        checked(
          MethodSchemas.recordHeldBack,
          [requestId, results],
          write(api, heldBackBody(requestId, results))
        ),
      recordLayerPush: (caller, input) =>
        checked(
          MethodSchemas.recordLayerPush,
          [caller, input],
          write(
            api,
            planned((snapshot, now) =>
              visibility.onLayerPush(
                { ...input, now, pusher: caller.handle },
                snapshot
              )
            )
          )
        ),
      recordLayerRead: (caller, input) =>
        checked(
          MethodSchemas.recordLayerRead,
          [caller, input],
          write(api, (_h, writes, now) =>
            absorb(
              writes,
              visibility.recordRead({
                at: now,
                handle: caller.handle,
                layer: input.layer,
                sha: Option.fromUndefinedOr(input.sha),
              })
            )
          )
        ),
      recordPush: (input) =>
        checked(MethodSchemas.recordPush, [input], write(api, pushBody(input))),
      rehearseOpen: (files) =>
        checked(
          MethodSchemas.rehearseOpen,
          [files],
          // Outside the lock: it reads, and writes nothing.
          Effect.gen(function* () {
            const h = yield* hydrate;

            return yield* rehearse(h, yield* DateTime.now, files);
          })
        ),
      release: (caller, id) =>
        checked(
          MethodSchemas.release,
          [caller, id],
          write(api, releaseBody(caller, id))
        ),
      scanForValues: (input) =>
        checked(
          MethodSchemas.scanForValues,
          [input],
          Effect.flatMap(hydrate, (h) => envPort.scan(input, h.snapshot))
        ),
      setEnv: (caller, input) =>
        checked(
          MethodSchemas.setEnv,
          [caller, input],
          write(api, setEnvBody(caller, input))
        ),
      showAsk: (caller, id) =>
        checked(
          MethodSchemas.showAsk,
          [caller, id],
          Effect.flatMap(hydrate, (h) =>
            Option.match(Option.fromUndefinedOr(h.asks.get(id)), {
              onNone: () => Effect.fail(new UnknownAsk({ ask: id })),
              onSome: (ask) => Effect.succeed({ ask, brief: briefOf(ask) }),
            })
          )
        ),
      showProposal: (caller, proposal) =>
        checked(
          MethodSchemas.showProposal,
          [caller, proposal],
          decided.showProposal(proposal)
        ),
      standing: () =>
        checked(
          MethodSchemas.standing,
          [],
          Effect.map(hydrate, (h): StandingNow => {
            const { posture, until } = visibility.standing(h.snapshot);

            return Option.match(until, {
              onNone: () => ({ posture, seen: h.lastSeq }),
              onSome: (at) => ({ posture, seen: h.lastSeq, until: at }),
            });
          })
        ),
      status: (caller) =>
        checked(MethodSchemas.status, [caller], statusOf(caller)),
      submitAnswer: (caller, input) =>
        checked(
          MethodSchemas.submitAnswer,
          [caller, input],
          write(api, submitBody(caller, input))
        ),
      today: (caller) =>
        checked(MethodSchemas.today, [caller], decided.today(caller)),
      verdict: (caller, input) =>
        checked(MethodSchemas.verdict, [caller, input], verdictOn(input)),
      vouch: (caller, input) =>
        checked(
          MethodSchemas.vouch,
          [caller, input],
          decided.vouch(api, caller, input)
        ),
    };

    return api;
  });
