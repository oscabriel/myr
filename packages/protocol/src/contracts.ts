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
import {
  Discussion,
  DiscussionListing,
  DiscussionTitle,
  PostBody,
} from "./domain/discussion.ts";
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
  DiscussionId,
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
  DiscussionClosed,
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
  UnknownDiscussion,
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
  listDiscussions: SurfaceName.literals,
  // A commit's diff and every path stay off MCP: no cap fits a transcript.
  // No command: git reads code locally.
  listPaths: ["rpc", "web"],
  listProjects: SurfaceName.literals,
  listRefs: ["rpc", "mcp", "web"],
  log: ["rpc", "mcp", "web"],
  openAsk: ["rpc", "mcp", "cli"],
  // The web adds no form for what the CLI does: a post is made from a terminal.
  postDiscussion: ["rpc", "mcp", "cli"],
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
  showDiscussion: SurfaceName.literals,
  showProposal: SurfaceName.literals,
  status: SurfaceName.literals,
  submitAnswer: ["rpc", "mcp", "cli"],
  today: SurfaceName.literals,
  verdict: SurfaceName.literals,
  vouch: ["rpc", "mcp", "cli"],
  watch: ["rpc", "web"],
  // The handle alone, read from the session: no project is woken for it.
  whoami: ["rpc", "mcp", "cli"],
  why: ["rpc", "mcp", "web"],
} as const satisfies Record<string, readonly SurfaceName[]>;

// An empty `Schema.Struct` has no object root in JSON Schema, which an MCP
// tool's input needs; this is the form `Tool.EmptyParams` takes.
const NoPayload = Schema.Record(Schema.String, Schema.Never);

// What a flag takes, said once: `--help` and each MCP tool's input schema read it.
const described = <S extends Schema.Top>(schema: S, description: string) =>
  schema.annotate({ description });

const baseField = described(
  CommitSha,
  "The commit your change is built on: main as the platform last landed it"
);

const headField = described(
  CommitSha,
  "The commit to check: the one you pushed to your fork"
);

const requestIdField = described(
  RequestId,
  "Any 8 to 64 letters, digits, - or _ you choose; sending the same one again returns the same receipt"
);

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
    kind: Schema.optionalKey(
      described(KindName, "Only asks of this kind, such as fix")
    ),
    reserved: Schema.optionalKey(
      described(Reserve, "Only asks held for newcomers, or for people")
    ),
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
  payload: {
    project: Schema.optionalKey(
      described(ProjectName, "The project to show; every project when absent")
    ),
  },
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

export class WhoAmI extends Rpc.make("whoami", {
  payload: NoPayload,
  success: Schema.Struct({ handle: Handle }),
})
  .annotate(
    Description,
    "Show who the caller is: the handle the platform takes them for, from the session alone."
  )
  .annotate(Audience, "signedIn")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "whoami" })
  .annotate(Surfaces, servedOn.whoami) {}

export class VerdictOf extends Rpc.make("verdict", {
  error: Schema.Union([UnknownProject, UnknownAsk]),
  payload: {
    ask: AskId,
    head: Schema.optionalKey(
      described(CommitSha, "The answer's head to show; its latest when absent")
    ),
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
  payload: { handle: described(Handle, "The person whose credits to count") },
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
    "Show the caller's Today: every open decision, soonest to expire first, each with its evidence and a safe default."
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
    /** `main`, a commit, a tag or a fork's address (`@<handle>/<ask>`); main's landed commit when absent. */
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
  error: Schema.Union([UnknownProject, UnknownCommit, UnknownRevision]),
  payload: {
    /** A fork's address, to read the commit in that fork; the project's own commits when absent. */
    at: Schema.optionalKey(Rev),
    project: ProjectName,
    sha: CommitSha,
  },
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
    "Show a project's evaluated config folder at its landed commit: who decides which paths, its vouches, caps, decision expiry and claim timing; for an import, its source."
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

export class ListDiscussions extends Rpc.make("listDiscussions", {
  error: UnknownProject,
  payload: { project: ProjectName },
  success: Schema.Struct({ discussions: Schema.Array(DiscussionListing) }),
})
  .annotate(
    Description,
    "List a project's discussions, newest post first: each thread's title, opener, state and the proposal it became."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "discussions" })
  .annotate(Surfaces, servedOn.listDiscussions) {}

export class ShowDiscussion extends Rpc.make("showDiscussion", {
  error: Schema.Union([UnknownProject, UnknownDiscussion]),
  payload: {
    discussion: described(DiscussionId, "The discussion to show"),
    project: ProjectName,
  },
  success: Schema.Struct({ discussion: Discussion }),
})
  .annotate(
    Description,
    "Show one discussion: its posts in order, its state and the proposal it became."
  )
  .annotate(Audience, "public")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, true)
  .annotate(Idempotent, true)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "discussion", positional: ["discussion"] })
  .annotate(Surfaces, servedOn.showDiscussion) {}

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
    files: described(
      Schema.NonEmptyArray(ConfigFile),
      "The ask file and its check, as JSON [{path, content}]; the CLI reads both from your working tree when it is left out"
    ),
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
  error: Schema.Union([
    UnknownProject,
    Denounced,
    CapReached,
    NotVouched,
    NotDecider,
    UnknownDiscussion,
    DiscussionClosed,
  ]),
  payload: Schema.Struct({
    /** The discussion this proposal comes from; a maintainer alone may name one, and it marks the thread proposed. */
    discussion: Schema.optionalKey(
      described(
        DiscussionId,
        "The discussion this proposal comes from; a maintainer alone may name one"
      )
    ),
    draft: Schema.optionalKey(
      described(
        Schema.Literal(true),
        "Have the platform's agent draft the ask file and its failing check"
      )
    ),
    files: Schema.optionalKey(
      described(
        Schema.NonEmptyArray(ConfigFile),
        "Your own ask file and check, as JSON [{path, content}]"
      )
    ),
    project: ProjectName,
    sealed: Schema.optionalKey(
      described(
        Schema.Struct({ head: CommitSha }),
        "An answer you already have, sealed until the ask opens, as JSON {head}"
      )
    ),
    territory: Schema.optionalKey(
      described(
        Schema.NonEmptyString,
        "The paths an answer may change, in your words"
      )
    ),
    want: described(
      Schema.NonEmptyString,
      "What should be true once the ask is answered"
    ),
  }).check(draftsAlone),
  success: Schema.Struct({ proposal: Proposal }),
})
  .annotate(
    Description,
    "Propose an ask, optionally with a sealed answer, or, as a maintainer, from a discussion; the proposal expires unless a maintainer accepts it."
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
    note: Schema.optionalKey(
      described(DraftNote, "What the next round should change, for the agent")
    ),
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
    reason: described(
      Schema.NonEmptyString,
      "What is wrong with the ask, for its maintainers"
    ),
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

const titleOrBody = Schema.makeFilter(
  (payload: {
    readonly body?: string;
    readonly discussion?: string;
    readonly title?: string;
  }) => {
    if (payload.discussion === undefined) {
      return payload.title === undefined
        ? "opening a discussion takes a title"
        : true;
    }

    return payload.body === undefined
      ? "a reply takes a body"
      : payload.title === undefined || "a reply takes no title";
  }
);

export class PostDiscussion extends Rpc.make("postDiscussion", {
  error: Schema.Union([
    UnknownProject,
    UnknownDiscussion,
    DiscussionClosed,
    Denounced,
    CapReached,
  ]),
  payload: Schema.Struct({
    body: Schema.optionalKey(described(PostBody, "Your post")),
    discussion: Schema.optionalKey(
      described(
        DiscussionId,
        "The discussion to reply in; leave out to open one"
      )
    ),
    project: ProjectName,
    title: Schema.optionalKey(
      described(DiscussionTitle, "The title of the discussion you open")
    ),
  }).check(titleOrBody),
  success: Schema.Struct({ discussion: Discussion }),
})
  .annotate(
    Description,
    "Post in a project's discussions: with no discussion named, open a thread with a title and an optional body; with one named, reply with a body. Anyone not denounced may."
  )
  .annotate(Audience, "signedIn")
  .annotate(Visibility, "public")
  .annotate(ReadOnly, false)
  .annotate(Idempotent, false)
  .annotate(Destructive, false)
  .annotate(NeedsApproval, false)
  .annotate(Cli, { name: "discussion post", positional: ["discussion"] })
  .annotate(Surfaces, servedOn.postDiscussion) {}

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
    choice: described(
      Choice,
      "accept or decline it; for a stray push, adopt or revert it"
    ),
    decision: described(DecisionId, "The decision's id, as Today lists it"),
    note: Schema.optionalKey(
      described(Schema.String, "Why, kept with the decision")
    ),
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
    base: baseField,
    head: headField,
    project: ProjectName,
    requestId: requestIdField,
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
    base: baseField,
    head: headField,
    project: ProjectName,
    requestId: requestIdField,
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
    base: baseField,
    head: headField,
    message: described(
      Schema.NonEmptyString,
      "The landing's commit message: what the change does"
    ),
    project: ProjectName,
    requestId: requestIdField,
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
    handle: described(Handle, "The person's handle"),
    note: Schema.optionalKey(
      described(Schema.String, "Why, kept beside the line in the vouch file")
    ),
    project: ProjectName,
    verdict: described(
      Schema.Literals(["vouch", "denounce"]),
      "vouch admits them to claim; denounce bars them from claiming and proposing"
    ),
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
    ref: described(
      Schema.NonEmptyString,
      "The logRef a failing lane's verdict names"
    ),
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
  WhoAmI,
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
  ListDiscussions,
  ShowDiscussion,
  InitProject,
  OpenAsk,
  ProposeAsk,
  DraftAsk,
  FlagAsk,
  PostDiscussion,
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
