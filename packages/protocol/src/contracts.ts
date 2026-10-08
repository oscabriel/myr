import { Context, Schema } from "effect";
import { Rpc, RpcGroup, RpcSchema } from "effect/rpc";
import type { RpcClient, RpcClientError } from "effect/rpc";

import {
  Audience,
  Cli,
  Description,
  Destructive,
  Idempotent,
  NeedsApproval,
  ReadOnly,
  SurfaceName,
  Surfaces,
  Visibility,
} from "./annotations.ts";
import {
  AnswerReceipt,
  AnswerView,
  LandReceipt,
  Verdict,
} from "./domain/answer.ts";
import { Ask, AskListing, Reserve } from "./domain/ask.ts";
import { ClaimView } from "./domain/claim.ts";
import { ConfigFile } from "./domain/common.ts";
import { Choice, Decision, Today } from "./domain/decision.ts";
import { EnvSchemaView } from "./domain/env.ts";
import { ProjectEvent } from "./domain/event.ts";
import { FrontPageEntry, ProjectListing } from "./domain/front-page.ts";
import { LandingView } from "./domain/landing.ts";
import { Proposal } from "./domain/proposal.ts";
import { CreditSummary } from "./domain/record.ts";
import { Ledger } from "./domain/visibility.ts";
import {
  AskId,
  CommitSha,
  DecisionId,
  EnvKey,
  Handle,
  KindName,
  LandedSha,
  LaneName,
  ProjectName,
  RepoName,
  RequestId,
} from "./ids.ts";
import { Authenticated } from "./principal.ts";
import {
  AskBlocked,
  AskFull,
  CapReached,
  ClaimLapsed,
  DecisionClosed,
  Denounced,
  ImportFailed,
  IncompleteBrief,
  NotClaimed,
  NotDecider,
  NotRedFirst,
  NotSensitive,
  NotVouched,
  OutOfScope,
  PrivatePathInPublicTree,
  ProjectExists,
  ReachedInternals,
  RepoBusy,
  StaleBase,
  TouchedJudge,
  UnknownAsk,
  UnknownCommit,
  UnknownDecision,
  UnknownEnvItem,
  UnknownProject,
  ValueTooShort,
  VerifierBlocked,
  WeakCheck,
  Weakened,
} from "./refusal.ts";

/** The keys every contract is annotated with, for the surfaces that read them. */
export {
  Audience,
  Cli,
  Description,
  Destructive,
  Idempotent,
  NeedsApproval,
  ReadOnly,
  SurfaceName,
  Surfaces,
  Visibility,
} from "./annotations.ts";

/**
 * The env shape contract's tag. Lint keeps "shape" out of code names, so the
 * tag is spelled once, here, and the contract's class is `EnvSchemaOf`.
 */
const envSchemaTag = "envShape";

/**
 * The surfaces each contract is served on (spec §3.2). Every contract's
 * `Surfaces` annotation is read from this table, and `surfaced` types each
 * surface's group by it, so the type and the annotation cannot disagree.
 */
const servedOn = {
  claim: ["rpc", "mcp", "cli"],
  credits: SurfaceName.literals,
  decide: SurfaceName.literals,
  [envSchemaTag]: SurfaceName.literals,
  // A log may hold text an agent's transcript should not carry: never MCP.
  evidence: ["rpc", "cli"],
  finish: ["rpc", "mcp", "cli"],
  flagAsk: ["rpc", "mcp", "cli"],
  fork: ["rpc", "mcp", "cli"],
  frontPage: SurfaceName.literals,
  initProject: ["rpc", "mcp", "cli"],
  land: ["rpc", "mcp", "cli"],
  landing: SurfaceName.literals,
  ledger: SurfaceName.literals,
  listAsks: SurfaceName.literals,
  listProjects: SurfaceName.literals,
  openAsk: ["rpc", "mcp", "cli"],
  proposeAsk: SurfaceName.literals,
  release: ["rpc", "mcp", "cli"],
  // A value must never pass through an agent's transcript, so never MCP.
  setEnv: ["rpc", "cli"],
  showAsk: SurfaceName.literals,
  status: SurfaceName.literals,
  submitAnswer: ["rpc", "mcp", "cli"],
  today: SurfaceName.literals,
  verdict: SurfaceName.literals,
  vouch: ["rpc", "mcp", "cli"],
  // A stream has no tool or command form.
  watch: ["rpc", "web"],
} as const satisfies Record<string, readonly SurfaceName[]>;

/**
 * The payload of a contract that takes nothing: an object with no keys. An
 * empty `Schema.Struct` has no object root in JSON Schema, which an MCP tool's
 * input needs; this is the form `Tool.EmptyParams` takes.
 */
const NoPayload = Schema.Record(Schema.String, Schema.Never);

// --- Reads ------------------------------------------------------------------

export class ListProjects extends Rpc.make("listProjects", {
  payload: NoPayload,
  success: Schema.Struct({ projects: Schema.Array(ProjectListing) }),
})
  .annotate(
    Description,
    "List every project on the platform, with its posture and how many asks it has open."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "projects" })
  .annotate(Surfaces, servedOn.listProjects) {}

export class FrontPage extends Rpc.make("frontPage", {
  payload: {
    kind: Schema.optionalKey(KindName),
    reserved: Schema.optionalKey(Reserve),
  },
  success: Schema.Struct({ entries: Schema.Array(FrontPageEntry) }),
})
  .annotate(
    Description,
    "List the open asks across every project, each saying whether the caller may take it; optionally of one kind, or held for newcomers or people."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "front" })
  .annotate(Surfaces, servedOn.frontPage) {}

export class ListAsks extends Rpc.make("listAsks", {
  error: UnknownProject,
  payload: { project: ProjectName },
  success: Schema.Struct({ asks: Schema.Array(AskListing) }),
})
  .annotate(Description, "List a project's open asks.")
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "asks" })
  .annotate(Surfaces, servedOn.listAsks) {}

export class ShowAsk extends Rpc.make("showAsk", {
  error: Schema.Union([UnknownProject, UnknownAsk]),
  payload: { ask: AskId, project: ProjectName },
  success: Schema.Struct({
    ask: Ask,
    /** The ask as an answerer reads it first, in Markdown. */
    brief: Schema.NonEmptyString,
  }),
})
  .annotate(
    Description,
    "Show one ask in full, with its brief in Markdown for an answerer to read first."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "ask", positional: ["ask"] })
  .annotate(Surfaces, servedOn.showAsk) {}

export class Status extends Rpc.make("status", {
  error: UnknownProject,
  payload: { project: Schema.optionalKey(ProjectName) },
  success: Schema.Struct({
    answers: Schema.Array(AnswerView),
    claims: Schema.Array(ClaimView),
    /** The caller's own handle, as the platform knows them. */
    handle: Handle,
  }),
})
  .annotate(
    Description,
    "Show who the caller is, and their claims and answers, in one project or in every one."
  )
  .annotate(Audience, "signedIn")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "status" })
  .annotate(Surfaces, servedOn.status) {}

export class VerdictOf extends Rpc.make("verdict", {
  error: Schema.Union([UnknownProject, UnknownAsk]),
  payload: {
    ask: AskId,
    /** The answer's head; its latest when absent. */
    head: Schema.optionalKey(CommitSha),
    project: ProjectName,
  },
  success: Schema.Struct({ verdict: Schema.optionalKey(Verdict) }),
})
  .annotate(
    Description,
    "Show the verdict on an answer to an ask, for its latest head or the one named; held-back checks show one bit per area."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { formerFlags: ["ask"], name: "verdict", positional: ["ask"] })
  .annotate(Surfaces, servedOn.verdict) {}

export class LandingOf extends Rpc.make("landing", {
  error: Schema.Union([UnknownProject, UnknownCommit]),
  payload: { project: ProjectName, sha: CommitSha },
  success: Schema.Struct({ landing: LandingView }),
})
  .annotate(
    Description,
    "Show one landing on a project's main: the ask it answered, the people it credits and its verdict."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "landing" })
  .annotate(Surfaces, servedOn.landing) {}

export class Credits extends Rpc.make("credits", {
  payload: { handle: Handle },
  success: Schema.Struct({ credits: Schema.Array(CreditSummary) }),
})
  .annotate(
    Description,
    "Count a person's credits by project, area and role; never a score."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "credits" })
  .annotate(Surfaces, servedOn.credits) {}

export class TodayOf extends Rpc.make("today", {
  error: Schema.Union([NotDecider, UnknownProject]),
  payload: { project: Schema.optionalKey(ProjectName) },
  success: Today,
})
  .annotate(
    Description,
    "Show the caller's Today: the decisions to take, held to their budget, each with its evidence and a safe default."
  )
  .annotate(Audience, "decider")
  // A decider's page: its evidence is for deciders, so no cache keeps it.
  .annotate(Visibility, "maintainers")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "today" })
  .annotate(Surfaces, servedOn.today) {}

export class LedgerOf extends Rpc.make("ledger", {
  error: UnknownProject,
  payload: { project: ProjectName },
  success: Ledger,
})
  .annotate(
    Description,
    "Show a project's ledger: its layers, counts, commitments, releases and posture changes."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "ledger" })
  .annotate(Surfaces, servedOn.ledger) {}

/** The env shape contract, named for the file it reads: `.env.schema`. */
export class EnvSchemaOf extends Rpc.make(envSchemaTag, {
  error: UnknownProject,
  payload: { project: ProjectName },
  success: EnvSchemaView,
})
  .annotate(
    Description,
    "Show a project's env shape: the public schema of its environment variables, and who set each write-only value; never a value."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "env shape" })
  .annotate(Surfaces, servedOn[envSchemaTag]) {}

export class Watch extends Rpc.make("watch", {
  error: UnknownProject,
  payload: {
    project: ProjectName,
    /** Replay from the event after this sequence number. */
    since: Schema.optionalKey(Schema.Int),
  },
  stream: true,
  success: ProjectEvent,
})
  .annotate(
    Description,
    "Stream what happens in a project as it happens, replaying from a sequence number when given one."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, false)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Surfaces, servedOn.watch) {}

// --- Writes -----------------------------------------------------------------

export class InitProject extends Rpc.make("initProject", {
  error: Schema.Union([ProjectExists, ImportFailed]),
  payload: {
    /** A public repo to import, instead of starting empty. */
    import: Schema.optionalKey(
      Schema.Struct({
        branch: Schema.optionalKey(Schema.NonEmptyString),
        url: Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/u)),
      })
    ),
    project: ProjectName,
  },
  success: Schema.Struct({
    /** Absent until the first push to an empty project. */
    landed: Schema.optionalKey(LandedSha),
    project: ProjectName,
    /** The project's URL at the gateway. */
    remote: Schema.NonEmptyString,
  }),
})
  .annotate(
    Description,
    "Make a project, empty or imported from a public git repo, with the caller as its decider."
  )
  .annotate(Audience, "signedIn")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, false)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, true)
  // The local `init` command calls it, with `--remote`.
  .annotate(Cli, { name: "init" })
  .annotate(Surfaces, servedOn.initProject) {}

export class OpenAsk extends Rpc.make("openAsk", {
  error: Schema.Union([
    UnknownProject,
    NotDecider,
    NotRedFirst,
    WeakCheck,
    IncompleteBrief,
    TouchedJudge,
    VerifierBlocked,
    StaleBase,
  ]),
  payload: {
    ask: AskId,
    files: Schema.NonEmptyArray(ConfigFile),
    project: ProjectName,
  },
  success: Schema.Struct({ ask: Ask, landed: LandedSha }),
})
  .annotate(
    Description,
    "Open an ask by landing its file, once its check fails on main by an assertion, twice in the same way."
  )
  .annotate(Audience, "decider")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, false)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, true)
  .annotate(Cli, { name: "ask open", positional: ["ask"] })
  .annotate(Surfaces, servedOn.openAsk) {}

export class ProposeAsk extends Rpc.make("proposeAsk", {
  // `NotVouched` under the `all` mode, or for a sealed answer from someone
  // unvouched under `forCode` (a vouch admits sealed answers).
  error: Schema.Union([UnknownProject, Denounced, CapReached, NotVouched]),
  payload: {
    files: Schema.optionalKey(Schema.NonEmptyArray(ConfigFile)),
    project: ProjectName,
    /** A sealed answer: the commit in the caller's working fork that answers it. */
    sealed: Schema.optionalKey(Schema.Struct({ head: CommitSha })),
    territory: Schema.optionalKey(Schema.NonEmptyString),
    want: Schema.NonEmptyString,
  },
  success: Schema.Struct({ proposal: Proposal }),
})
  .annotate(
    Description,
    "Propose an ask, optionally with a sealed answer; the proposal expires unless a decider accepts it."
  )
  .annotate(Audience, "signedIn")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, false)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "propose" })
  .annotate(Surfaces, servedOn.proposeAsk) {}

export class FlagAsk extends Rpc.make("flagAsk", {
  error: Schema.Union([UnknownProject, UnknownAsk, Denounced, CapReached]),
  payload: {
    ask: AskId,
    project: ProjectName,
    reason: Schema.NonEmptyString,
  },
  success: Schema.Struct({ proposal: Proposal }),
})
  .annotate(
    Description,
    "Flag an open ask to its deciders with a reason, as a proposal that expires unless a decider accepts it."
  )
  .annotate(Audience, "signedIn")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, false)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "ask flag", positional: ["ask"] })
  .annotate(Surfaces, servedOn.flagAsk) {}

export class Decide extends Rpc.make("decide", {
  error: Schema.Union([
    UnknownProject,
    UnknownDecision,
    DecisionClosed,
    NotDecider,
    // Accepting a proposal opens its ask, red first on main: a blocked
    // Checker or a main that moved fails the call, and the decider can
    // accept again.
    VerifierBlocked,
    StaleBase,
  ]),
  payload: {
    choice: Choice,
    decision: DecisionId,
    note: Schema.optionalKey(Schema.String),
    project: ProjectName,
  },
  success: Schema.Struct({ decision: Decision }),
})
  .annotate(
    Description,
    "Take one decision from Today: accept, decline, adopt or revert."
  )
  .annotate(Audience, "decider")
  // The decision's evidence is for deciders.
  .annotate(Visibility, "maintainers")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, false)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, true)
  .annotate(Cli, { name: "decide" })
  .annotate(Surfaces, servedOn.decide) {}

export class Claim extends Rpc.make("claim", {
  error: Schema.Union([
    UnknownProject,
    UnknownAsk,
    AskFull,
    AskBlocked,
    CapReached,
    NotVouched,
    Denounced,
  ]),
  payload: { ask: AskId, project: ProjectName },
  success: Schema.Struct({ claim: ClaimView }),
})
  .annotate(
    Description,
    "Claim an ask: an exclusive, expiring right to answer it, with a fork to push to; claiming it again returns the same claim."
  )
  .annotate(Audience, "signedIn")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "claim", positional: ["ask"] })
  .annotate(Surfaces, servedOn.claim) {}

export class Release extends Rpc.make("release", {
  error: Schema.Union([UnknownProject, NotClaimed]),
  payload: { ask: AskId, project: ProjectName },
  success: Schema.Struct({ released: Schema.Boolean }),
})
  .annotate(
    Description,
    "Release the caller's claim on an ask, so anyone may claim it again."
  )
  .annotate(Audience, "signedIn")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { formerFlags: ["ask"], name: "release", positional: ["ask"] })
  .annotate(Surfaces, servedOn.release) {}

export class SubmitAnswer extends Rpc.make("submitAnswer", {
  error: Schema.Union([
    UnknownProject,
    NotClaimed,
    ClaimLapsed,
    StaleBase,
    RepoBusy,
    OutOfScope,
    TouchedJudge,
    Weakened,
    ReachedInternals,
    PrivatePathInPublicTree,
  ]),
  payload: {
    ask: AskId,
    base: CommitSha,
    head: CommitSha,
    project: ProjectName,
    /** Offering the same request again returns the same receipt. */
    requestId: RequestId,
  },
  success: AnswerReceipt,
})
  .annotate(
    Description,
    "Offer the commit `head`, built on `base`, as an answer to a claimed ask; the receipt says it is being checked, and it lands if it passes."
  )
  .annotate(Audience, "signedIn")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { formerFlags: ["ask"], name: "submit", positional: ["ask"] })
  .annotate(Surfaces, servedOn.submitAnswer) {}

export class Finish extends Rpc.make("finish", {
  error: Schema.Union([
    UnknownProject,
    NotDecider,
    StaleBase,
    RepoBusy,
    TouchedJudge,
  ]),
  payload: {
    ask: AskId,
    base: CommitSha,
    head: CommitSha,
    project: ProjectName,
    requestId: RequestId,
  },
  success: AnswerReceipt,
})
  .annotate(
    Description,
    "Finish a passing answer with a decider's own commits on top; they are checked again, and credited with Finished-by when it lands."
  )
  .annotate(Audience, "decider")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, true)
  .annotate(Cli, { formerFlags: ["ask"], name: "finish", positional: ["ask"] })
  .annotate(Surfaces, servedOn.finish) {}

export class Land extends Rpc.make("land", {
  error: Schema.Union([UnknownProject, NotDecider, StaleBase, RepoBusy]),
  payload: {
    base: CommitSha,
    head: CommitSha,
    message: Schema.NonEmptyString,
    project: ProjectName,
    requestId: RequestId,
  },
  success: LandReceipt,
})
  .annotate(
    Description,
    "Land a decider's own change from their working fork, after the same checks an answer passes."
  )
  .annotate(Audience, "decider")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, true)
  .annotate(Cli, { name: "land" })
  .annotate(Surfaces, servedOn.land) {}

export class Fork extends Rpc.make("fork", {
  error: Schema.Union([UnknownProject, NotVouched, Denounced]),
  payload: { project: ProjectName },
  success: Schema.Struct({
    /** `<project>--me--<handle>`. */
    fork: RepoName,
    /** The fork's URL at the gateway. */
    remote: Schema.NonEmptyString,
  }),
})
  .annotate(
    Description,
    "Make the caller's working fork of a project, or return it if it exists."
  )
  .annotate(Audience, "signedIn")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "fork" })
  .annotate(Surfaces, servedOn.fork) {}

export class Vouch extends Rpc.make("vouch", {
  error: Schema.Union([UnknownProject, NotDecider, StaleBase]),
  payload: {
    handle: Handle,
    note: Schema.optionalKey(Schema.String),
    project: ProjectName,
    verdict: Schema.Literals(["vouch", "denounce"]),
  },
  success: Schema.Struct({ landed: LandedSha }),
})
  .annotate(
    Description,
    "Vouch for a person, or denounce them, by landing a line in the project's vouch file."
  )
  .annotate(Audience, "decider")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, false)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, true)
  .annotate(Cli, { name: "vouch" })
  .annotate(Surfaces, servedOn.vouch) {}

export class EvidenceOf extends Rpc.make("evidence", {
  error: Schema.Union([UnknownProject, NotDecider]),
  payload: {
    project: ProjectName,
    /** The `logRef` a verdict's lane or a `ChecksFailed` refusal names. */
    ref: Schema.NonEmptyString,
  },
  success: Schema.Struct({
    lane: LaneName,
    /** The log's tail: its last 256 KiB, where a failure prints. */
    text: Schema.String,
    /** Whether the log was longer than the tail given back. */
    truncated: Schema.Boolean,
  }),
})
  .annotate(
    Description,
    "Show the log a failing lane left, by the logRef its verdict names, to the answer's own claimant and the project's deciders only; the last 256 KiB."
  )
  // The handler lets in the answer's claimant and the project's deciders.
  .annotate(Audience, "signedIn")
  // A log is for its answerer and the deciders: no cache keeps it.
  .annotate(Visibility, "maintainers")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "evidence", positional: ["ref"] })
  .annotate(Surfaces, servedOn.evidence) {}

export class SetEnv extends Rpc.make("setEnv", {
  error: Schema.Union([
    UnknownProject,
    NotDecider,
    UnknownEnvItem,
    NotSensitive,
    ValueTooShort,
  ]),
  payload: {
    /** Store a value shorter than the item's minimum anyway. */
    acknowledgeShort: Schema.optionalKey(Schema.Boolean),
    key: EnvKey,
    project: ProjectName,
    /** The write-only value: the raw string on the wire, never printed. */
    value: Schema.RedactedFromValue(Schema.String),
  },
  success: Schema.Struct({
    key: EnvKey,
    setAt: Schema.DateTimeUtcFromString,
    setBy: Handle,
  }),
})
  .annotate(
    Description,
    "Set the write-only value of a sensitive env item; nobody can read it back."
  )
  .annotate(Audience, "decider")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, true)
  // The local `env set` command reads the value from stdin.
  .annotate(Cli, { name: "env set" })
  .annotate(Surfaces, servedOn.setEnv) {}

/** The one schema: every surface is a projection of this group. */
export class Contracts extends RpcGroup.make(
  ListProjects,
  FrontPage,
  ListAsks,
  ShowAsk,
  Status,
  VerdictOf,
  LandingOf,
  Credits,
  TodayOf,
  LedgerOf,
  EnvSchemaOf,
  Watch,
  InitProject,
  OpenAsk,
  ProposeAsk,
  FlagAsk,
  Decide,
  Claim,
  Release,
  SubmitAnswer,
  Finish,
  Land,
  Fork,
  Vouch,
  EvidenceOf,
  SetEnv
).middleware(Authenticated) {}

/** Every contract in the group, as its handlers and clients see it. */
export type Contract = RpcGroup.Rpcs<typeof Contracts>;

type ServedOn = typeof servedOn;

/** The tags of the contracts `surface` serves. */
export type TagOn<S extends SurfaceName> = {
  readonly [Tag in keyof ServedOn]: S extends ServedOn[Tag][number]
    ? Tag
    : never;
}[keyof ServedOn];

/** The contracts `surface` serves. */
export type ContractOn<S extends SurfaceName> = Extract<
  Contract,
  { readonly _tag: TagOn<S> }
>;

/**
 * Whether a contract is served on `surface`, by its `Surfaces` annotation.
 * The annotation is read from `servedOn`, which `ContractOn` reads too.
 */
const isServedOn =
  <S extends SurfaceName>(surface: S) =>
  (rpc: Contract): rpc is ContractOn<S> =>
    Context.get(rpc.annotations, Surfaces).includes(surface);

/** The group as one surface serves it: the contracts its `Surfaces` include, in order. */
export const surfaced = <S extends SurfaceName>(
  surface: S
): RpcGroup.RpcGroup<ContractOn<S>> =>
  RpcGroup.make(
    ...[...Contracts.requests.values()].filter(isServedOn(surface))
  );

/**
 * A contract's payload, success and error as a client meets them. A stream's
 * success is one of its elements, and its error is the stream's: the call
 * itself never fails outside the stream.
 */
export const partsOf = (rpc: Contract) =>
  RpcSchema.isStreamSchema(rpc.successSchema)
    ? {
        error: rpc.successSchema.error,
        payload: rpc.payloadSchema,
        success: rpc.successSchema.success,
      }
    : {
        error: rpc.errorSchema,
        payload: rpc.payloadSchema,
        success: rpc.successSchema,
      };

/** A way to call the contracts, in process or over the wire. */
export class Client extends Context.Service<
  Client,
  RpcClient.RpcClient<
    RpcGroup.Rpcs<typeof Contracts>,
    RpcClientError.RpcClientError
  >
>()("protocol/Client") {}
