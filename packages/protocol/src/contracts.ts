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
import {
  CommitDiff,
  CommitView,
  PathList,
  RefsView,
  Rev,
  FileView,
  TreeListing,
  WhyView,
} from "./domain/code.ts";
import { ConfigFile, NoneOrMore } from "./domain/common.ts";
import { Choice, Decision, Today } from "./domain/decision.ts";
import { EnvSchemaView } from "./domain/env.ts";
import { ProjectEvent } from "./domain/event.ts";
import { FrontPageEntry, ProjectListing } from "./domain/front-page.ts";
import { LandingView } from "./domain/landing.ts";
import { ImportSource, PolicyPending, PublicPolicy } from "./domain/policy.ts";
import { DraftNote, Proposal } from "./domain/proposal.ts";
import { RecentLandings } from "./domain/recent-landing.ts";
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
  ProposalId,
  RepoName,
  RepoPath,
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
  DraftInProgress,
  ImportFailed,
  NotYourNamespace,
  IncompleteBrief,
  NotClaimed,
  NotDecider,
  NotRedFirst,
  NotSensitive,
  NotVouched,
  OutOfScope,
  PrivatePathInPublicTree,
  ProjectExists,
  ProposalClosed,
  ReachedInternals,
  RepoBusy,
  StaleBase,
  TouchedJudge,
  UnknownAsk,
  UnknownCommit,
  UnknownDecision,
  UnknownEnvItem,
  UnknownPath,
  UnknownProject,
  UnknownProposal,
  UnknownRevision,
  ValueTooShort,
  VerifierBlocked,
  WeakCheck,
  Weakened,
} from "./refusal.ts";

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

// Lint keeps "shape" out of code names, so the tag is spelled once, here.
const envSchemaTag = "envShape";

const servedOn = {
  claim: ["rpc", "mcp", "cli"],
  credits: SurfaceName.literals,
  decide: SurfaceName.literals,
  draftAsk: SurfaceName.literals,
  [envSchemaTag]: SurfaceName.literals,
  // A log may hold text an agent's transcript should not carry: never MCP.
  evidence: ["rpc", "cli"],
  finish: ["rpc", "mcp", "cli"],
  flagAsk: ["rpc", "mcp", "cli"],
  fork: ["rpc", "mcp", "cli"],
  frontPage: SurfaceName.literals,
  initProject: ["rpc", "mcp", "cli", "web"],
  land: ["rpc", "mcp", "cli"],
  landing: SurfaceName.literals,
  ledger: SurfaceName.literals,
  listAsks: SurfaceName.literals,
  // A commit's diff and every path stay off MCP: no cap fits a transcript.
  // No command: git reads code locally.
  listPaths: ["rpc", "web"],
  listProjects: SurfaceName.literals,
  listRefs: ["rpc", "mcp", "web"],
  log: ["rpc", "mcp", "web"],
  openAsk: ["rpc", "mcp", "cli"],
  projectPolicy: SurfaceName.literals,
  proposeAsk: SurfaceName.literals,
  readFile: ["rpc", "mcp", "web"],
  readTree: ["rpc", "mcp", "web"],
  // A list with no command: an agent asks it over MCP, a person reads it on the landing.
  recentLandings: ["rpc", "mcp", "web"],
  release: ["rpc", "mcp", "cli"],
  // A value must never pass through an agent's transcript, so never MCP.
  setEnv: ["rpc", "cli"],
  showAsk: SurfaceName.literals,
  showCommit: ["rpc", "web"],
  showProposal: SurfaceName.literals,
  status: SurfaceName.literals,
  submitAnswer: ["rpc", "mcp", "cli"],
  today: SurfaceName.literals,
  verdict: SurfaceName.literals,
  vouch: ["rpc", "mcp", "cli"],
  watch: ["rpc", "web"],
  why: ["rpc", "mcp", "web"],
} as const satisfies Record<string, readonly SurfaceName[]>;

// An empty `Schema.Struct` has no object root in JSON Schema, which an MCP
// tool's input needs; this is the form `Tool.EmptyParams` takes.
const NoPayload = Schema.Record(Schema.String, Schema.Never);

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

export class RecentLandingsOf extends Rpc.make("recentLandings", {
  payload: NoPayload,
  success: Schema.Struct({ landings: RecentLandings }),
})
  .annotate(
    Description,
    "List the latest landings across every project, and the answers the gate refused, the latest first: when, the project, the ask and its want, and each refusal's tag and area."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Surfaces, servedOn.recentLandings) {}

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

export class ListRefs extends Rpc.make("listRefs", {
  error: UnknownProject,
  payload: { project: ProjectName },
  success: RefsView,
})
  .annotate(
    Description,
    "List a project's refs: main's landed commit, its tags peeled to their commits, and its forks."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Surfaces, servedOn.listRefs) {}

export class ReadTree extends Rpc.make("readTree", {
  error: Schema.Union([UnknownProject, UnknownRevision, UnknownPath]),
  payload: {
    /** `main`, a commit or a tag; main's landed commit when absent. */
    at: Schema.optionalKey(Rev),
    path: Schema.optionalKey(RepoPath),
    project: ProjectName,
  },
  success: TreeListing,
})
  .annotate(
    Description,
    "List one folder of a project at a revision, folders first, with its README when it has one."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Surfaces, servedOn.readTree) {}

export class ListPaths extends Rpc.make("listPaths", {
  error: Schema.Union([UnknownProject, UnknownRevision]),
  payload: { at: Schema.optionalKey(Rev), project: ProjectName },
  success: PathList,
})
  .annotate(
    Description,
    "List every file path in a project at a revision, up to a cap."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Surfaces, servedOn.listPaths) {}

export class ReadFile extends Rpc.make("readFile", {
  error: Schema.Union([UnknownProject, UnknownRevision, UnknownPath]),
  payload: {
    at: Schema.optionalKey(Rev),
    path: RepoPath,
    project: ProjectName,
  },
  success: FileView,
})
  .annotate(
    Description,
    "Read one file of a project at a revision: its text, or that it is binary or too large to show."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Surfaces, servedOn.readFile) {}

export class LogOf extends Rpc.make("log", {
  error: Schema.Union([UnknownProject, UnknownRevision]),
  payload: {
    at: Schema.optionalKey(Rev),
    from: Schema.optionalKey(NoneOrMore),
    /** 30 when absent. */
    limit: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 }))
    ),
    path: Schema.optionalKey(RepoPath),
    project: ProjectName,
  },
  success: Schema.Struct({
    commits: Schema.Array(CommitView),
    /** Where the next page starts; absent on the last. */
    next: Schema.optionalKey(NoneOrMore),
  }),
})
  .annotate(
    Description,
    "List a project's commits along first parents from a revision, newest first, each landing with its ask, people and verdict."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Surfaces, servedOn.log) {}

export class ShowCommit extends Rpc.make("showCommit", {
  error: Schema.Union([UnknownProject, UnknownCommit]),
  payload: { project: ProjectName, sha: CommitSha },
  success: CommitDiff,
})
  .annotate(
    Description,
    "Show one commit of a project and the files it changed against its first parent."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Surfaces, servedOn.showCommit) {}

export class WhyOf extends Rpc.make("why", {
  error: Schema.Union([UnknownProject, UnknownRevision, UnknownPath]),
  payload: {
    at: Schema.optionalKey(Rev),
    path: RepoPath,
    project: ProjectName,
  },
  success: WhyView,
})
  .annotate(
    Description,
    "Say why each line of a file is there: the commit that brought it, and the landing, ask and people behind that commit."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Surfaces, servedOn.why) {}

export class PolicyOf extends Rpc.make("projectPolicy", {
  error: UnknownProject,
  payload: { project: ProjectName },
  success: Schema.Struct({
    importedFrom: Schema.optionalKey(ImportSource),
    policy: Schema.optionalKey(PublicPolicy),
    unevaluated: Schema.optionalKey(PolicyPending),
  }),
})
  .annotate(
    Description,
    "Show a project's evaluated config folder at its landed commit: who decides which paths, its vouches, caps, budget and claim timing; for an import, its source."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "policy" })
  .annotate(Surfaces, servedOn.projectPolicy) {}

export class ShowProposal extends Rpc.make("showProposal", {
  error: Schema.Union([UnknownProject, UnknownProposal]),
  payload: { project: ProjectName, proposal: ProposalId },
  success: Schema.Struct({
    files: Schema.Array(ConfigFile),
    proposal: Proposal,
  }),
})
  .annotate(
    Description,
    "Show one proposal, its draft's state and the ask files it holds."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "proposal", positional: ["proposal"] })
  .annotate(Surfaces, servedOn.showProposal) {}

export class InitProject extends Rpc.make("initProject", {
  error: Schema.Union([ProjectExists, NotYourNamespace, ImportFailed]),
  payload: {
    import: Schema.optionalKey(ImportSource),
    project: ProjectName,
  },
  success: Schema.Struct({
    landed: Schema.optionalKey(LandedSha),
    project: ProjectName,
    remote: Schema.NonEmptyString,
  }),
})
  .annotate(
    Description,
    "Make a project, empty or imported from a public git repo, with the caller as its maintainer."
  )
  .annotate(Audience, "signedIn")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, false)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, true)
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

const draftsAlone = Schema.makeFilter(
  (payload: {
    readonly draft?: true;
    readonly files?: unknown;
    readonly sealed?: unknown;
  }) =>
    payload.draft === undefined ||
    (payload.files === undefined && payload.sealed === undefined)
      ? true
      : "a drafted proposal carries neither files nor a sealed answer"
);

export class ProposeAsk extends Rpc.make("proposeAsk", {
  error: Schema.Union([UnknownProject, Denounced, CapReached, NotVouched]),
  payload: Schema.Struct({
    draft: Schema.optionalKey(Schema.Literal(true)),
    files: Schema.optionalKey(Schema.NonEmptyArray(ConfigFile)),
    project: ProjectName,
    sealed: Schema.optionalKey(Schema.Struct({ head: CommitSha })),
    territory: Schema.optionalKey(Schema.NonEmptyString),
    want: Schema.NonEmptyString,
  }).check(draftsAlone),
  success: Schema.Struct({ proposal: Proposal }),
})
  .annotate(
    Description,
    "Propose an ask, optionally with a sealed answer; the proposal expires unless a maintainer accepts it."
  )
  .annotate(Audience, "signedIn")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, false)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "propose" })
  .annotate(Surfaces, servedOn.proposeAsk) {}

export class DraftAsk extends Rpc.make("draftAsk", {
  error: Schema.Union([
    UnknownProject,
    UnknownProposal,
    ProposalClosed,
    NotDecider,
    DraftInProgress,
    CapReached,
  ]),
  payload: {
    note: Schema.optionalKey(DraftNote),
    project: ProjectName,
    proposal: ProposalId,
  },
  success: Schema.Struct({ proposal: Proposal }),
})
  .annotate(
    Description,
    "Have the platform's agent draft, or draft again, an open proposal's ask and its failing check; the proposer or a maintainer may ask."
  )
  .annotate(Audience, "signedIn")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, false)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "ask draft", positional: ["proposal"] })
  .annotate(Surfaces, servedOn.draftAsk) {}

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
    "Flag an open ask to its maintainers with a reason, as a proposal that expires unless a maintainer accepts it."
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
    "Finish a passing answer with a maintainer's own commits on top; they are checked again, and credited with Finished-by when it lands."
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
    "Land a maintainer's own change from their working fork, after the same checks an answer passes."
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
    fork: RepoName,
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
    ref: Schema.NonEmptyString,
  },
  success: Schema.Struct({
    lane: LaneName,
    /** The log's tail: its last 256 KiB, where a failure prints. */
    text: Schema.String,
    truncated: Schema.Boolean,
  }),
})
  .annotate(
    Description,
    "Show the log a failing lane left, by the logRef its verdict names, to the answer's own claimant and the project's maintainers only; the last 256 KiB."
  )
  // The handler lets in the answer's claimant and the project's maintainers.
  .annotate(Audience, "signedIn")
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
  .annotate(Cli, { name: "env set" })
  .annotate(Surfaces, servedOn.setEnv) {}

export class Contracts extends RpcGroup.make(
  ListProjects,
  RecentLandingsOf,
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
  ListRefs,
  ReadTree,
  ListPaths,
  ReadFile,
  LogOf,
  ShowCommit,
  WhyOf,
  PolicyOf,
  ShowProposal,
  InitProject,
  OpenAsk,
  ProposeAsk,
  DraftAsk,
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

export type Contract = RpcGroup.Rpcs<typeof Contracts>;

type ServedOn = typeof servedOn;

export type TagOn<S extends SurfaceName> = {
  readonly [Tag in keyof ServedOn]: S extends ServedOn[Tag][number]
    ? Tag
    : never;
}[keyof ServedOn];

export type ContractOn<S extends SurfaceName> = Extract<
  Contract,
  { readonly _tag: TagOn<S> }
>;

const isServedOn =
  <S extends SurfaceName>(surface: S) =>
  (rpc: Contract): rpc is ContractOn<S> =>
    Context.get(rpc.annotations, Surfaces).includes(surface);

export const surfaced = <S extends SurfaceName>(
  surface: S
): RpcGroup.RpcGroup<ContractOn<S>> =>
  RpcGroup.make(
    ...[...Contracts.requests.values()].filter(isServedOn(surface))
  );

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

export class Client extends Context.Service<
  Client,
  RpcClient.RpcClient<
    RpcGroup.Rpcs<typeof Contracts>,
    RpcClientError.RpcClientError
  >
>()("protocol/Client") {}
