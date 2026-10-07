/**
 * The project service: every contract's server logic for one project
 * (spec §4.2), host-free, over ports. Each call hydrates the project from
 * its store, moves its lifecycles by pure transitions, persists rows, outbox
 * and events in one commit, then settles the outbox (ADR 0012): forks,
 * projected events, answer runs and unwritten bookkeeping, each retried by
 * the next alarm when it fails. Deadlines (claims warned and lapsed, retries)
 * run on the project's one alarm, set to the earliest pending one.
 *
 * Calls that write run one at a time per project; the slow part of an
 * answer (merge, checks, land) runs outside that lock, in the answer's run,
 * which reports each step back through `advanceAnswer`. Every method checks
 * its arguments and its result against the contract's or the domain's
 * schemas (`MethodSchemas`, principle 2), which W3's Durable Object boundary
 * reuses.
 */
import { BranchName, RefName, RepoHost } from "@repo/artifacts/repo-host";
import type { RepoNotFound } from "@repo/artifacts/repo-host";
import { memoryFs } from "@repo/artifacts/repo-host/memory-fs";
import { Brand } from "@repo/brand";
import { CheckAt, CheckLane, CheckRunner } from "@repo/checks/check-runner";
import { findRunBlock } from "@repo/checks/finder";
import { judgeClosure } from "@repo/checks/judge";
import { checkVersion, commandFor } from "@repo/checks/kinds";
import { redFirstOfRuns } from "@repo/checks/red-first";
import { weaknessesOf } from "@repo/checks/weak-shapes";
import { PushTarget } from "@repo/gate/facts";
import type { PushFacts } from "@repo/gate/facts";
import { pushStages, runGate } from "@repo/gate/gate";
import { scan } from "@repo/gate/stages/shape";
import { verdictOf } from "@repo/gate/verdict";
import { patchId } from "@repo/git/patch-id";
import { formatLanding } from "@repo/git/trailers";
import {
  Claim as ClaimContract,
  Credits,
  Decide,
  EnvSchemaOf,
  Finish,
  FlagAsk,
  Fork,
  InitProject,
  Land,
  LandingOf,
  LedgerOf,
  ListAsks,
  OpenAsk,
  ProposeAsk,
  Release,
  SetEnv,
  ShowAsk,
  Status,
  SubmitAnswer,
  TodayOf,
  VerdictOf,
  Vouch,
} from "@repo/protocol/contracts";
import { AnswerReceipt, Verdict } from "@repo/protocol/domain/answer";
import type {
  AnswerView,
  HeldBackResult,
  LaneResult,
} from "@repo/protocol/domain/answer";
import type { Ask, AskListing } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import type { ClaimView } from "@repo/protocol/domain/claim";
import { RefNameText } from "@repo/protocol/domain/common";
import type { Credit } from "@repo/protocol/domain/credit";
import type { Decision } from "@repo/protocol/domain/decision";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { AskKind } from "@repo/protocol/domain/kind";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { StageName } from "@repo/protocol/domain/outcome";
import { Policy } from "@repo/protocol/domain/policy";
import type { Proposal } from "@repo/protocol/domain/proposal";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  RepoName,
  RepoPath,
  RequestId,
  sameHandle,
} from "@repo/protocol/ids";
import type {
  DecisionId,
  LaneName,
  ProjectName,
  ProposalId,
} from "@repo/protocol/ids";
import { Person, Principal } from "@repo/protocol/principal";
import {
  AskFull,
  DirectPush,
  ImportFailed,
  IncompleteBrief,
  NotClaimed,
  NotDecider,
  NotRedFirst,
  ProjectExists,
  Refusal,
  StaleBase,
  TouchedJudge,
  UnknownAsk,
  UnknownCommit,
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
  Context,
  DateTime,
  Effect,
  Layer,
  Match,
  Option,
  Order,
  Record,
  Result,
  Schema,
  Semaphore,
  Struct,
} from "effect";
import { init } from "isomorphic-git";

import { Alarms } from "./alarms.ts";
import {
  AnswerReport,
  AnswerRun,
  ReportedCommand,
  Steps,
} from "./answer-runs.ts";
import type { AnswerQueue, AnswerRuns, RunnableEffect } from "./answer-runs.ts";
import { isStep } from "./answer-runs/steps.ts";
import { recordOf } from "./attention/record.ts";
import { mayClaim, standing } from "./attention/vouch.ts";
import {
  ClaimCommand,
  ClaimEffect,
  ClaimState,
  forkName,
  toView,
  transition as claimTransition,
} from "./claim.ts";
import type { ClaimStep, Live } from "./claim.ts";
import {
  deciderDeadlines,
  deciders,
  decidesOn,
  envSchemaMethod,
  isDecider,
  nextDecisionId,
  strayDecision,
} from "./deciders.ts";
import type { DeciderApi, Opening } from "./deciders.ts";
import { askClosed, askOpened, judged, listingOf, numbered } from "./events.ts";
import type { ProjectEventInput } from "./events.ts";
import { evaluationFacts, pushFacts, targetOf } from "./facts.ts";
import type { MissingCommit } from "./facts.ts";
import { Lander, Rebuild } from "./lander.ts";
import type { ComposedFile } from "./lander.ts";
import {
  LandingCommand,
  LandingEffect,
  LandingState,
  outcomeOf,
  transition as landingTransition,
} from "./landing.ts";
import type { LandingQueue, Request } from "./landing.ts";
import {
  isDue,
  outboxRow,
  OutboxBody,
  projectedRows,
  runOutbox,
  startRow,
} from "./outbox.ts";
import { ProjectStore } from "./project-store.ts";
import type { ProjectWrites } from "./project-store.ts";
import type {
  AnswerRow,
  BudgetDayRow,
  ClaimRow,
  OutboxRow,
  ProjectRow,
  PushEventRow,
} from "./project-store/rows.ts";
import type { Projection } from "./projection.ts";
import { askToLand, holdsSlot, leave, queueOf, storedQueue } from "./queue.ts";

/** Every port one project's service runs on. */
export type ProjectPorts =
  | Alarms
  | AnswerRuns
  | CheckRunner
  | Lander
  | ProjectStore
  | Projection
  | RepoHost
  | RulesEvaluator;

/**
 * The platform's gateway, where every repo's git URL starts: what a claim's
 * and a project's `remote` name. Never an Artifacts URL. The platform's
 * Worker sets its own (W3); the default is the product's domain.
 */
export const GatewayUrl = Context.Reference<string>("project/GatewayUrl", {
  defaultValue: () => `https://${Brand.domain}`,
});

/**
 * The rules evaluator's finishers from `@repo/checks`: the run-block finder
 * and the judge closure (spec §4.2 `rules`, which may not import `checks`).
 * Every rules evaluator adapter needs it beside the project's ports.
 */
export const FinishersFromChecks: Layer.Layer<Finishers> = Layer.succeed(
  Finishers,
  { findRunBlock, judgeClosure }
);

/** A push one repo took, as the gateway's custody reports it (W3 303). */
export const PushReport = Schema.Struct({
  after: CommitSha,
  before: Schema.Option(CommitSha),
  /** The push event's id; the same event reported twice is acted on once. */
  eventId: Schema.NonEmptyString,
  pusher: Principal,
  ref: Schema.NonEmptyString,
  repo: RepoName,
});

export type PushReport = typeof PushReport.Type;

/** One file a decider opens an ask with: its ask file, or its check. */
export interface AskFile {
  readonly content: string;
  readonly path: RepoPath;
}

/** The refusals `submitAnswer` answers with. */
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

/**
 * Every contract's server logic for one project. Each method takes its
 * caller explicitly: one project's service serves many callers. The
 * decider-facing methods (Today, proposals, decisions, finishes, a
 * decider's own landings, vouches, credits, the ledger and the env shape)
 * are `DeciderApi`'s, with their bodies in `deciders.ts`.
 */
export interface ProjectApi extends AnswerQueue, DeciderApi {
  // reads
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
  readonly events: (
    since: number,
    limit: number
  ) => Effect.Effect<
    readonly { readonly event: ProjectEvent; readonly seq: number }[]
  >;
  /**
   * Who may make the project's first push to its canonical `main`: its
   * initializer, while the project awaits that push (spec §5 step 1); no
   * one once it has a landed SHA. The gateway's custody reads it before a
   * push reaches the canonical repo.
   */
  readonly firstPusher: () => Effect.Effect<Option.Option<Handle>>;
  // writes
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
    ProjectExists | ImportFailed
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
  /**
   * A push a claim fork took: liveness for its claimant's claim, and stages
   * 0–1 over it. The fork keeps the commit whatever the gate says; the
   * refusals, every one at once, reach the pusher in git's output. The same
   * push event reported again changes nothing.
   */
  readonly recordPush: (input: PushReport) => Effect.Effect<readonly Refusal[]>;
  /**
   * Stages 0–1 over the answer, then its run starts and the receipt says it
   * is being checked (spec D5). The same `requestId`, or the same head from
   * the same person while its first answer stands, returns the first receipt.
   * Of stage 1's refusals the first comes back; `recordPush` lists them all.
   */
  readonly submitAnswer: (
    caller: Person,
    input: {
      readonly ask: AskId;
      readonly base: CommitSha;
      readonly head: CommitSha;
      readonly requestId: RequestId;
    }
  ) => Effect.Effect<AnswerReceipt, SubmitRefusal>;
  /**
   * The project's alarm fired: deadlines that passed move (claims warned
   * and lapsed, proposals expired, decisions defaulted), and outbox rows
   * due run again.
   */
  readonly onAlarm: () => Effect.Effect<void>;
}

/** The schemas one method's arguments (in order), success and failure cross a boundary with. */
export interface MethodSchema {
  readonly args: readonly Schema.Top[];
  readonly error: Schema.Top;
  readonly success: Schema.Top & { readonly EncodingServices: never };
}

/**
 * Every `ProjectApi` method's schemas: contract methods take their success
 * and failure from `Contracts`, the rest from the domain. The service checks
 * each argument and each success against them; W3's Durable Object boundary
 * (302) encodes and decodes with the same ones.
 */
export const MethodSchemas = {
  [envSchemaMethod]: {
    args: [Principal],
    error: EnvSchemaOf.errorSchema,
    success: EnvSchemaOf.successSchema,
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
  events: {
    args: [Schema.Int, Schema.Int],
    error: Schema.Never,
    success: Schema.Array(
      Schema.Struct({ event: ProjectEvent, seq: Schema.Int })
    ),
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
  proposeAsk: {
    args: [
      Person,
      ProposeAsk.payloadSchema.mapFields(Struct.omit(["project"])),
    ],
    error: ProposeAsk.errorSchema,
    success: ProposeAsk.successSchema,
  },
  recordFirstPush: {
    args: [Person, CommitSha],
    error: DirectPush,
    success: Schema.Struct({ landed: LandedSha }),
  },
  recordPush: {
    args: [PushReport],
    error: Schema.Never,
    success: Schema.Array(Refusal),
  },
  release: {
    args: [Person, AskId],
    error: Release.errorSchema,
    success: Release.successSchema,
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
  status: {
    args: [Person],
    error: Status.errorSchema,
    success: Status.successSchema,
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

/**
 * Where one answer stands, as its row keeps it: the landing lifecycle's
 * state, the receipt its request was first given (a replay gets it again),
 * and the verdict on its last checked tree.
 */
export const AnswerRecord = Schema.Struct({
  landing: LandingState,
  receipt: AnswerReceipt,
  verdict: Schema.optionalKey(Verdict),
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

/**
 * A method run between the check of its arguments (each against its
 * schema's type side: a value that is not one is the caller's defect, since
 * the boundary that decoded it would have refused it) and the check that its
 * success encodes.
 */
const checked = <A, E>(
  schemas: MethodSchema,
  args: readonly unknown[],
  run: Effect.Effect<A, E>
): Effect.Effect<A, E> =>
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

const mainRef = RefName.make("refs/heads/main");

const HOUR = 3_600_000;

/** The claim deadlines before a project has a policy: the defaults (spec §2.5). */
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

/** A project as one call reads it at its start. */
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
}

/**
 * What one call writes, gathered as it goes and committed at its end. The
 * project row and the queue are kept in one-entry maps, so the record itself
 * never changes. Budget days are keyed by day and decider.
 */
interface Writes {
  readonly answers: Map<RequestId, AnswerRow>;
  readonly asks: Map<AskId, Ask>;
  readonly budgetDays: Map<string, BudgetDayRow>;
  readonly claims: Map<string, ClaimRow>;
  readonly decisions: Map<DecisionId, Decision>;
  readonly events: ProjectEventInput[];
  readonly landings: LandingView[];
  readonly outbox: OutboxRow[];
  readonly project: Map<"row", ProjectRow>;
  readonly proposals: Map<ProposalId, Proposal>;
  readonly pushEvents: PushEventRow[];
  readonly queue: Map<"queue", LandingQueue>;
}

const writesOf = (): Writes => ({
  answers: new Map(),
  asks: new Map(),
  budgetDays: new Map(),
  claims: new Map(),
  decisions: new Map(),
  events: [],
  landings: [],
  outbox: [],
  project: new Map(),
  proposals: new Map(),
  pushEvents: [],
  queue: new Map(),
});

const isEmpty = (writes: Writes) =>
  [
    writes.answers.size,
    writes.asks.size,
    writes.budgetDays.size,
    writes.claims.size,
    writes.decisions.size,
    writes.events.length,
    writes.landings.length,
    writes.outbox.length,
    writes.project.size,
    writes.proposals.size,
    writes.pushEvents.length,
    writes.queue.size,
  ].every((count) => count === 0);

const claimKey = (ask: AskId, claimant: Handle) =>
  JSON.stringify([ask, claimant.toLowerCase()]);

/** A claim's own fields, in every state but `Open`. */
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

/** When a live claim's next deadline is: its warning, or once warned its lapse. */
const deadlineOf = (state: ClaimState): Option.Option<DateTime.Utc> =>
  ClaimState.match(state, {
    Answered: () => Option.none(),
    Lapsed: () => Option.none(),
    Live: ({ warnsAt }) => Option.some(warnsAt),
    Open: () => Option.none(),
    Released: () => Option.none(),
    Warned: ({ lapsesAt }) => Option.some(lapsesAt),
  });

/** A path a composed commit can hold: plain folder names and a file name. */
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

/** Whether the brief holds a field its kind requires. */
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

/** An optional field as an object to spread: the field when present, nothing when not. */
const field = <K extends string, A>(
  key: K,
  value: Option.Option<A>
): Partial<Record<K, A>> =>
  Option.match(value, {
    onNone: () => ({}),
    onSome: (present) => Record.singleton(key, present),
  });

/** The credit an answer's landing carries: who asked, who answered, who mentored. */
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

/** What a check of `ask` runs, and the lane it reports as. */
const askLaneOf = (policy: Policy, ask: Ask) =>
  commandFor(ask.check, policy.run, policy.ratchets);

/** The lanes an answer's checks run: the ask's own check, then every project lane. */
const lanesOf = (
  policy: Policy,
  ask: Option.Option<Ask>
): readonly CheckLane[] => [
  ...Option.toArray(
    Option.flatMap(ask, (asked) =>
      Option.map(askLaneOf(policy, asked), ({ command, lane }) =>
        CheckLane.make({ command, lane })
      )
    )
  ),
  ...Record.toEntries(policy.run.checks).map(([lane, command]) =>
    CheckLane.make({ command, lane })
  ),
];

/** A section of a brief, when it has lines. */
const section = (heading: string, lines: readonly string[] | undefined) =>
  lines === undefined || lines.length === 0
    ? []
    : ["", `## ${heading}`, "", ...lines];

const listed = (lines: readonly string[] | undefined) =>
  lines?.map((line) => `- ${line}`);

/** What an ask's check holds it to, in a sentence. */
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

/** The ask as an answerer reads it first, in Markdown. */
const briefOf = (ask: Ask): string => {
  const { brief, territory } = ask;
  const paths = territory.paths.map((path) => `\`${path}\``).join(", ");

  return [
    `# ${brief.want}`,
    "",
    `Ask \`${ask.id}\` in ${ask.project}, a \`${ask.kind}\` ask from ${ask.askedBy}.`,
    ...section("Territory", [`The module \`${territory.module}\`: ${paths}.`]),
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

/** The refusal `submitAnswer` gives for one from the gate: its own, or `NotClaimed`. */
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

/** A landing's commit message, from the platform's own rows (spec §5 step 8). */
const messageOf = (
  request: Request,
  ask: Option.Option<Ask>,
  verdict: Verdict
): string => {
  const message = {
    assisted: request.assisted,
    credits: request.credits,
    requestId: request.requestId,
    subject: "Land a change",
    verdict: { checkVersion: verdict.checkVersion, patchId: verdict.patchId },
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

/** Answers oldest first, by when their row last moved. */
const byUpdated = Order.mapInput(
  DateTime.Order,
  ({ row }: Answered) => row.updatedAt
);

/**
 * The verdict a landing carries: the one the checks gave, whose outcome
 * was the answer's when it was judged (a stage still to pass), now `Landed`
 * at the landing's SHA (W3 311 #9).
 */
const landedVerdict = (verdict: Option.Option<Verdict>, sha: LandedSha) =>
  Option.map(verdict, (made): Verdict => ({
    ...made,
    outcome: Outcome.cases.Landed.make({ sha }),
  }));

/** A `Landed` event with the verdict the landing carries; any other event as it is. */
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

/** Whether a landing's effect is for the answer's run: a step, or a retry to wait for. */
const runnable = (effect: LandingEffect): effect is RunnableEffect =>
  isStep(effect) || LandingEffect.$is("Retry")(effect);

const isTouchedJudge = (refusal: Refusal): refusal is TouchedJudge =>
  Match.value(refusal).pipe(
    Match.tag("TouchedJudge", () => true),
    Match.orElse(() => false)
  );

type Checking = Extract<LandingState, { readonly _tag: "Checking" }>;

type Landing = Extract<LandingState, { readonly _tag: "Landing" }>;

/** What a landing's effects leave: the steps to hand to the run, and the queue. */
interface Settled {
  readonly queue: LandingQueue;
  readonly steps: readonly LandingEffect[];
}

/** Starts the run of a request the queue just admitted, unless it is the one advancing. */
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

/** Whether an ask's check file has one of the five weak shapes. */
const weakness = (ask: Ask, files: readonly AskFile[]) => {
  const { check } = ask;

  const file = CheckSpec.guards.RedThenGreen(check)
    ? Option.fromUndefinedOr(files.find(({ path }) => path === check.path))
    : Option.none<AskFile>();

  return Option.flatMap(file, (found) =>
    Array.head(weaknessesOf(found, ask.territory.paths))
  );
};

/** Stage 0–1's refusals for a push, every one; what a missing commit or repo comes to. */
const gateOf = (
  facts: Effect.Effect<PushFacts, RepoNotFound | MissingCommit>,
  missing: readonly Refusal[],
  stale: readonly Refusal[]
) =>
  facts.pipe(
    Effect.flatMap((each) => runGate(pushStages, each)),
    Effect.map((found) =>
      Option.getOrElse(
        Option.map(found, (all): readonly Refusal[] => all),
        () => []
      )
    ),
    Effect.catchTags({
      MissingCommit: () => Effect.succeed(stale),
      RepoNotFound: () => Effect.succeed(missing),
    })
  );

/** The queue once a request no longer landing has left its place in it. */
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

/** One project's service over the ports. */
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
    const lock = yield* Semaphore.make(1);
    const repo = RepoName.make(name);

    const withPorts = <A, E>(effect: Effect.Effect<A, E, ProjectPorts>) =>
      Effect.provideContext(effect, ports);

    // ----------------------------------------------------------- hydrate

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
      };
    });

    /** The project row once it is live: it has a landed SHA. */
    const liveRow = (h: Hydrated) =>
      Option.flatMap(h.project, (row) =>
        row.state === "live" && row.landed !== undefined
          ? Option.some({ landed: row.landed, row })
          : Option.none()
      );

    /** The ask as this call has it: as written so far, or as hydrated. */
    const askNow = (h: Hydrated, writes: Writes, id: AskId) =>
      Option.fromUndefinedOr(writes.asks.get(id) ?? h.asks.get(id));

    const ownClaim = (h: Hydrated, ask: AskId, handle: Handle) =>
      Option.fromUndefinedOr(
        h.claims.find(
          ({ row }) => row.ask === ask && sameHandle(row.claimant, handle)
        )
      );

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

    /** A claim as its claimant sees it: with its fork's gateway URL and its check. */
    const viewOf = (
      policy: Option.Option<Policy>,
      ask: Option.Option<Ask>,
      state: ClaimState
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
          toView(state, {
            checkCommand,
            project: name,
            remote: `${gateway}/${fork}.git`,
          })
        );
      });

    // ------------------------------------------------------------ commit

    /**
     * Writes everything the call gathered in one commit, with the events'
     * projection rows beside them, and returns the outbox rows it wrote. A
     * commit carrying a push event already stored wrote nothing: none.
     */
    const commit = (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
      Effect.gen(function* () {
        if (isEmpty(writes)) {
          return [];
        }

        const events = yield* numbered(h.lastSeq, writes.events);
        const projected = yield* projectedRows(name, events, now);

        const outbox = [...writes.outbox, ...projected];

        const queue = yield* Effect.forEach(writes.queue.values(), (each) =>
          storedQueue(each)
        );

        const all: ProjectWrites = {
          answers: [...writes.answers.values()],
          asks: [...writes.asks.values()],
          budgetDays: [...writes.budgetDays.values()],
          claims: [...writes.claims.values()],
          decisions: [...writes.decisions.values()],
          events: writes.events,
          landings: writes.landings,
          outbox,
          proposals: [...writes.proposals.values()],
          pushEvents: writes.pushEvents,
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

    // ------------------------------------------------------------ settle

    /** Sets the project's alarm to its earliest pending deadline or retry. */
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

    /**
     * Runs the outbox rows that are due, acknowledges the ones done, puts
     * the rest back with a later time, then sets the alarm.
     */
    const settle = (queue: AnswerQueue, rows: readonly OutboxRow[]) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;

        const due = Array.dedupeWith(
          rows.filter((row) => isDue(row, now)),
          (one, other) => one.id === other.id
        );

        if (Array.isReadonlyArrayNonEmpty(due)) {
          const ran = yield* withPorts(runOutbox(due, queue, now));

          yield* store.ackOutbox(ran.done);

          if (Array.isReadonlyArrayNonEmpty(ran.retry)) {
            yield* lock.withPermits(1)(store.commit({ outbox: ran.retry }));
          }
        }

        yield* armAlarm;
      });

    /**
     * One call that writes: under the project's lock it hydrates, runs
     * `body` (pure transitions, and the port calls that decide them), and
     * commits what it gathered; then, outside the lock, settles the outbox
     * rows it wrote. A body that fails commits nothing.
     */
    const write = <A, E>(
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

    // ------------------------------------------------------------ claims

    /** The ask's state once a claim on it moved: claimed while a live claim holds it. */
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

    /** Records a claim's step: its row, its fork, its events and its ask's state. */
    const applyClaim = (
      h: Hydrated,
      writes: Writes,
      ask: AskId,
      step: ClaimStep,
      now: DateTime.Utc
    ) =>
      Effect.gen(function* () {
        const claim = claimOf(step.state);

        if (Option.isNone(claim)) {
          return;
        }

        const { claimant } = claim.value;

        writes.claims.set(claimKey(ask, claimant), {
          ask,
          claimant,
          state: yield* Effect.orDie(encodeClaim(step.state)),
          updatedAt: now,
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

    // ------------------------------------------------------------ policy

    /** The config folder at a commit, evaluated; none when it can't be. */
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

    /**
     * The project row with the policy at `at`: the config folder bundled
     * there and evaluated. A Lander or evaluator that fails keeps the policy
     * the row held (spec §5 step 2).
     */
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

    /** A `main` for an imported repo whose branch had another name, at its tip. */
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
     * An imported repo adopted: its tip becomes the first landed SHA, on a
     * `main` of its own when the imported branch had another name.
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
              RepoExists: () =>
                Effect.fail(new ProjectExists({ project: name })),
            })
          );

        const refs = yield* host.refs(repo).pipe(Effect.orDie);

        const imported = RefName.make(
          `refs/heads/${Option.getOrElse(named, () => "main")}`
        );

        const tip = Option.fromNullishOr(
          refs.get(mainRef) ?? refs.get(imported)
        );

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

    // ------------------------------------------------------------ answers

    /** The answer's run, as `answer` and a step see it. */
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
        message: messageOf(request, ask, each),
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
          "run",
          Option.map(h.policy, ({ run }) => run)
        ),
        ...Option.getOrElse(judgedRun, () => ({})),
      };
    };

    /** The verdict on a checked tree: the gate's `verdictOf` over what the checks saw. */
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
          ratchetCounts: new Map(),
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

    /** The claim that answered an ask, answered by its landing. */
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

    /**
     * A landing on main recorded: the landing, its ask closed, the answering
     * claim answered, the landed SHA moved and the policy read there.
     */
    const recordLanding = (
      h: Hydrated,
      writes: Writes,
      landing: Landing,
      landed: {
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

    /** One of a landing's effects, settled by the project or handed to its run. */
    const settleEffect = (
      context: {
        readonly before: LandingState;
        readonly h: Hydrated;
        readonly now: DateTime.Utc;
        readonly requestId: RequestId;
        readonly verdict: Option.Option<Verdict>;
        readonly writes: Writes;
      },
      settled: Settled,
      effect: LandingEffect
    ): Effect.Effect<Settled> => {
      const { before, h, now, requestId, verdict, writes } = context;
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
                recordLanding(h, writes, before, { sha, verdict }, now),
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

    /**
     * The verdict after a step: a fresh one when the checks just judged the
     * tree under way, else the one the answer had.
     */
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

    /** The row that lands a request's job again, for the bookkeeping it left unwritten. */
    const bookkeepingRow = (input: {
      readonly ask: Option.Option<Ask>;
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
            message: messageOf(request, input.ask, input.verdict),
            repo,
            requestId: request.requestId,
            tree: input.landing.tree,
            verdict: input.verdict,
          },
        }),
        DateTime.addDuration(input.now, "1 second")
      );
    };

    /** Bookkeeping a land reported unwritten: landed again later, for it alone. */
    const keepBooks = (input: {
      readonly ask: Option.Option<Ask>;
      readonly before: LandingState;
      readonly command: LandingCommand;
      readonly now: DateTime.Utc;
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
          landing: before,
          now: input.now,
          verdict: input.verdict.value,
        }),
        (row) => input.writes.outbox.push(row)
      );
    };

    /** One reported step of an answer, under the lock: its transition and all it settles. */
    const advanceBody =
      (requestId: RequestId, command: LandingCommand, report?: AnswerReport) =>
      (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
        Effect.gen(function* () {
          const found = findAnswer(h, requestId);

          if (Option.isNone(found)) {
            return yield* Effect.die(`no answer request ${requestId}`);
          }

          const { record, row } = found.value;
          const before = record.landing;
          const { effects, state } = landingTransition(before, command, now);
          const { request } = state;

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

          const settled = yield* Effect.reduce(
            effects,
            (): Settled => ({ queue: h.queue, steps: [] }),
            (each, effect) =>
              settleEffect(
                { before, h, now, requestId, verdict, writes },
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

    // ------------------------------------------------------------ writes

    /**
     * The first adoption as a landing: the initializer's first push, or an
     * import's tip. It answers no ask and has no parent; its row lets
     * `landing` (and so OnPush) know the commit as the platform's own.
     */
    const adoption = (
      author: Handle,
      sha: LandedSha,
      now: DateTime.Utc
    ): LandingView => ({
      assisted: [],
      author,
      credits: [],
      landedAt: now,
      project: name,
      sha,
    });

    const initBody =
      (
        caller: Person,
        input: {
          readonly import?: { readonly branch?: string; readonly url: string };
        }
      ) =>
      (h: Hydrated, writes: Writes, now: DateTime.Utc) =>
        Effect.gen(function* () {
          if (Option.isSome(h.project)) {
            return yield* new ProjectExists({ project: name });
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

          writes.landings.push(adoption(caller.handle, landed, now));
          writes.project.set(
            "row",
            yield* withPolicyAt({ ...made, landed, state: "live" }, landed, now)
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

          if (row.state === "live") {
            return row.landed === landed ? { landed } : yield* refused;
          }

          writes.landings.push(adoption(row.initializer, landed, now));
          writes.project.set(
            "row",
            yield* withPolicyAt({ ...row, landed, state: "live" }, landed, now)
          );

          return { landed };
        });

    /**
     * The ask a decider's files state, read from the config folder at the
     * commit they compose; its kind, as every rule but the ask itself, is
     * main's (ADR 0005).
     */
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

    /** The judge an ask's files touch beyond their own (stage 1, as an ask opens). */
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
          ratchetCounts: new Map(),
          ref: RefNameText.make("refs/heads/main"),
          scriptsChanged: false,
          target: PushTarget.Canonical({ project: name }),
        }),
        (refusals) => Array.findFirst(refusals, isTouchedJudge)
      );

    /** Red first: the ask's check fails twice on the composed commit, the same way. */
    const redTwice = (policy: Policy, ask: Ask, composed: CommitSha) =>
      Effect.gen(function* () {
        const lane = askLaneOf(policy, ask);

        if (Option.isNone(lane)) {
          return yield* new NotRedFirst({});
        }

        const job = {
          at: CheckAt.cases.Commit.make({ commit: composed }),
          lanes: [CheckLane.make(lane.value)],
          placeholders: [],
          project: name,
          proxies: [],
          repo,
          run: policy.run,
        };

        const first = yield* runner.run(job);
        const second = yield* runner.run(job);

        return yield* Effect.fromResult(
          redFirstOfRuns([first, second], lane.value.lane)
        );
      });

    /** The landing that opens an ask: its files on main, authored by its asker. */
    const landAsk = (input: {
      readonly ask: Ask;
      readonly credits: readonly Credit[];
      readonly files: Array.NonEmptyReadonlyArray<ComposedFile>;
      readonly main: LandedSha;
      readonly tree: Checking["tree"];
    }) => {
      const requestId = RequestId.make(`open-${input.tree}`);
      const { credits } = input;

      const landing = lander
        .land({
          author: input.ask.askedBy,
          main: input.main,
          message: formatLanding({
            ask: { ask: input.ask.id, project: name },
            assisted: [],
            body: input.ask.brief.want,
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

    /**
     * An ask opened from its files, red first, and landed as a platform
     * commit: what `openAsk` does for a decider, and what an accepted
     * proposal does for its proposer (221). `opening.decider` must decide
     * for the ask's territory; `opening.asker` asks it and authors the
     * landing, which carries `opening.credits`.
     */
    const openFrom = (
      h: Hydrated,
      writes: Writes,
      now: DateTime.Utc,
      opening: Opening
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
            ? { ask: stillOpen.value, landed: stillOpen.value.openedIn }
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

        yield* redTwice(policy, ask, composed.commit);

        const landed = yield* landAsk({
          ask,
          credits: opening.credits,
          files,
          main,
          tree: composed.tree,
        });

        const opened: Ask = { ...ask, openedIn: landed.sha };

        writes.asks.set(opened.id, opened);
        writes.events.push(askOpened(opened, now));
        writes.landings.push({
          assisted: [],
          author: opening.asker,
          credits: landed.credits,
          landedAt: now,
          parent: main,
          project: name,
          requestId: landed.requestId,
          sha: landed.sha,
        });
        writes.project.set(
          "row",
          yield* withPolicyAt({ ...row, landed: landed.sha }, landed.sha, now)
        );

        return { ask: opened, landed: landed.sha };
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
          credits: [{ handle: caller.handle, role: "Asked-by" }],
          decider: caller,
          files: input.files,
        });

    /** Whether a person may claim an ask, by the trust rules (220), and the ask's race. */
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
            blockedBy: ask.value.blockedBy.filter(
              (blocker) => h.asks.get(blocker)?.state !== "closed"
            ),
            cap: policy.caps.claimsPerPerson,
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

          if (step.effects.length > 0) {
            yield* applyClaim(h, writes, id, step, now);
          }

          const view = yield* viewOf(h.policy, ask, step.state);

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

    /** The claimant's own push keeps their claim alive, whatever the gate says of it. */
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
              onSuccess: (step) => applyClaim(h, writes, row.ask, step, now),
            }
          ),
      });
    };

    /**
     * Canonical `main` moved to a commit that is neither the landed SHA nor
     * a landing, or deleted, opens a `StrayPush` decision, in the same
     * commit as the push event's row, so an event reported again opens
     * nothing (W3 313).
     */
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
            onSome: ({ state }) => viewOf(h.policy, ask, state),
          });

          const base = Option.getOrElse(
            Option.map(
              Option.flatMap(claimed, ({ state }) => claimOf(state)),
              (claim) => claim.base
            ),
            () => live.value.landed
          );

          const refusals = yield* gateOf(
            withPorts(
              pushFacts({
                ask,
                base,
                claim: view,
                claimsHeld: Principal.guards.Person(input.pusher)
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

          return refusals;
        });

    /**
     * The receipt of an answer given before: the caller's own request
     * again, or the same head from them while that answer stands. A
     * request id another person's answer holds is not the caller's to
     * replay, nor to take: `NotClaimed`.
     */
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

    /** A new answer request, queued and started on main as it stands, with its receipt. */
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
            encodeAnswer({ landing: started.state, receipt })
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
            () => forkName(name, input.ask, caller.handle)
          );

          const view = yield* Option.match(own, {
            onNone: () => Effect.succeedNone,
            onSome: ({ state }) => viewOf(h.policy, ask, state),
          });

          const facts = yield* withPorts(
            pushFacts({
              ask,
              base: input.base,
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
                    base: input.base,
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
              assisted: [],
              base: input.base,
              credits: creditsFor(ask.value, caller.handle),
              fork,
              head: input.head,
              project: name,
              requestId: input.requestId,
            },
            { ask: input.ask, main: live.value.landed, now }
          );
        });

    /** Every live claim whose deadline passed, moved by `Tick`. */
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

    // ------------------------------------------------------------ reads

    const statusOf = (caller: Person) =>
      Effect.gen(function* () {
        const h = yield* hydrate;

        const claims = yield* Effect.forEach(
          h.claims.filter(({ row }) => sameHandle(row.claimant, caller.handle)),
          ({ row, state }) =>
            viewOf(h.policy, Option.fromUndefinedOr(h.asks.get(row.ask)), state)
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

    // ---------------------------------------------------------- deciders

    /** The decider-facing methods (221), over the same hydrate, write and helpers. */
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
          return `${yield* GatewayUrl}/${fork}.git`;
        }),
      repo,
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

            return [...(yield* commit(h, writes, now)), ...h.outbox];
          })
        );

        yield* settle(queue, rows);
      });

    // ------------------------------------------------------------ the api

    const api: ProjectApi = {
      [envSchemaMethod]: (caller) =>
        checked(
          MethodSchemas[envSchemaMethod],
          [caller],
          decided.envSchema(caller)
        ),
      advanceAnswer: (requestId, command, report) =>
        checked(
          MethodSchemas.advanceAnswer,
          [requestId, command, report],
          write(api, advanceBody(requestId, command, report))
        ),
      answer: (requestId) =>
        checked(
          MethodSchemas.answer,
          [requestId],
          Effect.map(hydrate, (h) =>
            Option.map(findAnswer(h, requestId), (found) => runOf(h, found))
          )
        ),
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
      events: (since, limit) =>
        checked(
          MethodSchemas.events,
          [since, limit],
          Effect.map(store.eventsSince(since, limit), (rows) =>
            rows.map(({ event, seq }) => ({ event, seq }))
          )
        ),
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
              onSome: (landing) => Effect.succeed({ landing }),
            })
          )
        ),
      ledger: (caller) =>
        checked(MethodSchemas.ledger, [caller], decided.ledger),
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
      proposeAsk: (caller, input) =>
        checked(
          MethodSchemas.proposeAsk,
          [caller, input],
          decided.proposeAsk(api, caller, input)
        ),
      recordFirstPush: (caller, head) =>
        checked(
          MethodSchemas.recordFirstPush,
          [caller, head],
          write(api, firstPushBody(caller, head))
        ),
      recordPush: (input) =>
        checked(MethodSchemas.recordPush, [input], write(api, pushBody(input))),
      release: (caller, id) =>
        checked(
          MethodSchemas.release,
          [caller, id],
          write(api, releaseBody(caller, id))
        ),
      setEnv: (caller, input) =>
        checked(
          MethodSchemas.setEnv,
          [caller, input],
          decided.setEnv(caller, input)
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
