import { Brand } from "@repo/brand";
import { Effect, Schema } from "effect";

import { At } from "./domain/common.ts";
import {
  AskId,
  CommitSha,
  DecisionId,
  DiscussionId,
  EnvKey,
  Handle,
  LandedSha,
  ProjectName,
  ProposalId,
  RepoPath,
  shortNameOf,
} from "./ids.ts";
import { Posture } from "./posture.ts";

export { At } from "./domain/common.ts";

const cli = (...args: readonly string[]) => [Brand.cli, ...args].join(" ");

// A `next` fixed per tag names what the tag does not carry as a placeholder,
// spelled as the docs spell it.
const PROJECT = "<owner>/<name>";

const ASK = "<ask>";

// A code read is an MCP tool with no command: its `next` is the tool call
// that would answer, as an agent with no shell makes it.
const tool = (name: string, payload: Record<string, string>) =>
  `${name} ${JSON.stringify(payload)}`;

// A push to the claim's fork; the platform merges onto the moved main itself.
const pushAnswer = `git push ${Brand.slug} HEAD:main`;

const Label = Schema.NonEmptyString;

const Paths = Schema.NonEmptyArray(RepoPath);

// Every refusal carries `retryable`, fixed per tag, and `next`, the command to
// run next. Both are fields, not statics: Effect's MCP server sends only what
// the failure schema encodes. No refusal has a `message`, so MCP sends JSON.
const Retryable = {
  at: Schema.optionalKey(At),
  next: Schema.NonEmptyString,
  retryable: Schema.tag(true),
};

const Final = { ...Retryable, retryable: Schema.tag(false) };

const nextIs = (command: string) => ({
  next: Schema.NonEmptyString.pipe(
    Schema.withConstructorDefault(Effect.succeed(command))
  ),
});

export class NotClaimed extends Schema.TaggedError<NotClaimed>()("NotClaimed", {
  ...Retryable,
  ask: AskId,
}) {
  static readonly of = (ask: AskId) =>
    new NotClaimed({ ask, next: cli("claim", ask) });
}

export class ClaimLapsed extends Schema.TaggedError<ClaimLapsed>()(
  "ClaimLapsed",
  {
    ...Retryable,
    ask: AskId,
  }
) {
  static readonly of = (ask: AskId) =>
    new ClaimLapsed({ ask, next: cli("claim", ask) });
}

export class NotVouched extends Schema.TaggedError<NotVouched>()("NotVouched", {
  ...Final,
  ...nextIs(cli("policy", "--project", PROJECT)),
}) {}

export class CapReached extends Schema.TaggedError<CapReached>()("CapReached", {
  ...Retryable,
  ...nextIs(cli("status")),
  cap: Schema.Int,
  /** Which limit: claims held (also when absent), proposals, drafts, or discussions. */
  limit: Schema.optionalKey(
    Schema.Literals(["claims", "proposals", "drafts", "discussions"])
  ),
  /** For a rate limit: seconds until one more is let through. */
  retryAfter: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
  ),
}) {}

export class AskFull extends Schema.TaggedError<AskFull>()("AskFull", {
  ...Retryable,
  ...nextIs(cli("asks")),
  ask: AskId,
}) {}

export class NoAsk extends Schema.TaggedError<NoAsk>()("NoAsk", {
  ...Final,
  ...nextIs(cli("asks")),
}) {}

export class RepoBusy extends Schema.TaggedError<RepoBusy>()("RepoBusy", {
  ...Retryable,
  ...nextIs("git push"),
}) {}

export class DirectPush extends Schema.TaggedError<DirectPush>()("DirectPush", {
  ...Final,
  ...nextIs(cli("fork", "--project", PROJECT)),
  ref: Label,
}) {}

export class AskBlocked extends Schema.TaggedError<AskBlocked>()("AskBlocked", {
  ...Retryable,
  ...nextIs(cli("asks")),
  ask: AskId,
  blockedBy: Schema.NonEmptyArray(AskId),
}) {
  static readonly of = (
    ask: AskId,
    blockedBy: readonly [AskId, ...(readonly AskId[])]
  ) => new AskBlocked({ ask, blockedBy });
}

export class Denounced extends Schema.TaggedError<Denounced>()("Denounced", {
  ...Final,
  ...nextIs(cli("policy", "--project", PROJECT)),
}) {}

export class OutOfScope extends Schema.TaggedError<OutOfScope>()("OutOfScope", {
  ...Final,
  ...nextIs(cli("check")),
  paths: Paths,
}) {}

export class TouchedJudge extends Schema.TaggedError<TouchedJudge>()(
  "TouchedJudge",
  {
    ...Final,
    ...nextIs(cli("check")),
    paths: Paths,
  }
) {}

export class Weakened extends Schema.TaggedError<Weakened>()("Weakened", {
  ...Final,
  ...nextIs(cli("check")),
  weakening: Schema.Union([
    Schema.Struct({ marker: Label, reason: Schema.optionalKey(Label) }),
    Schema.Struct({
      after: Schema.Int,
      before: Schema.Int,
      ratchet: Label,
      territory: Label,
    }),
  ]),
}) {}

export class PrivatePathInPublicTree extends Schema.TaggedError<PrivatePathInPublicTree>()(
  "PrivatePathInPublicTree",
  { ...Final, ...nextIs(cli("check")), paths: Paths }
) {}

export class ReachedInternals extends Schema.TaggedError<ReachedInternals>()(
  "ReachedInternals",
  { ...Final, ...nextIs(cli("check")), from: RepoPath, to: Label }
) {}

export const MovedBy = Schema.Struct({
  ask: Schema.optionalKey(AskId),
  author: Handle,
  landing: LandedSha,
  path: RepoPath,
});

export type MovedBy = typeof MovedBy.Type;

// Never a rebase: the claim's base stays where it was granted, and a rebased
// answer earns `OutOfScope` for every sibling's file.
export class StaleBase extends Schema.TaggedError<StaleBase>()("StaleBase", {
  ...Retryable,
  ...nextIs(pushAnswer),
  base: CommitSha,
  conflicts: Schema.Array(RepoPath),
  main: CommitSha,
  movedBy: Schema.optionalKey(Schema.NonEmptyArray(MovedBy)),
}) {}

export class StaleLayer extends Schema.TaggedError<StaleLayer>()("StaleLayer", {
  ...Retryable,
  ...nextIs(cli("status")),
  layer: Label,
}) {}

const LOCAL = "local:";

export class ChecksFailed extends Schema.TaggedError<ChecksFailed>()(
  "ChecksFailed",
  {
    ...Final,
    lane: Label,
    logRef: Label,
  }
) {
  /** A lane whose log held a stored write-only value: the log was never kept. */
  static readonly withheld = "withheld";

  static readonly localRef = (lane: string) => `${LOCAL}${lane}`;

  static readonly isLocal = (logRef: string) => logRef.startsWith(LOCAL);
}

/** A held-back check failed; only its area and suite are disclosed. */
export class HeldBackFailed extends Schema.TaggedError<HeldBackFailed>()(
  "HeldBackFailed",
  {
    ...Final,
    ...nextIs(cli("verdict", ASK, "--project", PROJECT)),
    area: Label,
    suite: Label,
  }
) {}

export class AttemptsExhausted extends Schema.TaggedError<AttemptsExhausted>()(
  "AttemptsExhausted",
  {
    ...Retryable,
    ...nextIs(cli("status")),
    area: Label,
    resetsAt: Schema.DateTimeUtcFromString,
  }
) {}

export class Flake extends Schema.TaggedError<Flake>()("Flake", {
  ...Retryable,
  ...nextIs(cli("status")),
  lane: Label,
}) {}

export class VerifierBlocked extends Schema.TaggedError<VerifierBlocked>()(
  "VerifierBlocked",
  { ...Retryable, ...nextIs(cli("status")) }
) {}

// An ask's file lands by opening it, so the local check, which reads the asks
// on a landed base, cannot judge one yet: the ask is opened again.
export class NotRedFirst extends Schema.TaggedError<NotRedFirst>()(
  "NotRedFirst",
  {
    ...Final,
    ...nextIs(cli("ask", "open", ASK, "--project", PROJECT)),
  }
) {}

export class WeakCheck extends Schema.TaggedError<WeakCheck>()("WeakCheck", {
  ...Final,
  ...nextIs(cli("check")),
  weakness: Label,
}) {}

export class IncompleteBrief extends Schema.TaggedError<IncompleteBrief>()(
  "IncompleteBrief",
  {
    ...Final,
    ...nextIs(cli("ask", "open", ASK, "--project", PROJECT)),
    missing: Schema.NonEmptyArray(Label),
  }
) {}

export class LayerContentInPublicTree extends Schema.TaggedError<LayerContentInPublicTree>()(
  "LayerContentInPublicTree",
  { ...Final, ...nextIs(cli("check")), paths: Paths }
) {}

export class SecretInOutput extends Schema.TaggedError<SecretInOutput>()(
  "SecretInOutput",
  {
    ...Final,
    ...nextIs(cli("check")),
    item: Label,
    where: Schema.Literals(["output", "tree"]),
  }
) {}

export class UnstatedRequirement extends Schema.TaggedError<UnstatedRequirement>()(
  "UnstatedRequirement",
  { ...Final, ...nextIs(cli("check")), area: Label }
) {}

export class PostureChange extends Schema.TaggedError<PostureChange>()(
  "PostureChange",
  { ...Final, ...nextIs(cli("today")), from: Posture, to: Posture }
) {}

export class NotDecider extends Schema.TaggedError<NotDecider>()("NotDecider", {
  ...Final,
  ...nextIs(cli("policy", "--project", PROJECT)),
}) {}

export class DecisionClosed extends Schema.TaggedError<DecisionClosed>()(
  "DecisionClosed",
  { ...Final, ...nextIs(cli("today")), decision: DecisionId }
) {}

export class ProposalClosed extends Schema.TaggedError<ProposalClosed>()(
  "ProposalClosed",
  { ...Final, ...nextIs(cli("today")), proposal: ProposalId }
) {}

export class DiscussionClosed extends Schema.TaggedError<DiscussionClosed>()(
  "DiscussionClosed",
  { ...Final, ...nextIs(cli("discussions")), discussion: DiscussionId }
) {}

export class DraftInProgress extends Schema.TaggedError<DraftInProgress>()(
  "DraftInProgress",
  { ...Retryable, proposal: ProposalId }
) {
  static readonly of = (proposal: ProposalId) =>
    new DraftInProgress({ next: cli("proposal", proposal), proposal });
}

export class UnknownProject extends Schema.TaggedError<UnknownProject>()(
  "UnknownProject",
  { ...Final, ...nextIs(cli("projects")), project: ProjectName }
) {}

export class UnknownAsk extends Schema.TaggedError<UnknownAsk>()("UnknownAsk", {
  ...Final,
  ...nextIs(cli("asks")),
  ask: AskId,
}) {}

export class UnknownCommit extends Schema.TaggedError<UnknownCommit>()(
  "UnknownCommit",
  { ...Final, ...nextIs(tool("log", { project: PROJECT })), sha: CommitSha }
) {}

export class UnknownDecision extends Schema.TaggedError<UnknownDecision>()(
  "UnknownDecision",
  { ...Final, ...nextIs(cli("today")), decision: DecisionId }
) {}

export class UnknownPath extends Schema.TaggedError<UnknownPath>()(
  "UnknownPath",
  {
    ...Final,
    ...nextIs(tool("readTree", { at: "main", project: PROJECT })),
    commit: CommitSha,
    path: RepoPath,
  }
) {}

export class UnknownRevision extends Schema.TaggedError<UnknownRevision>()(
  "UnknownRevision",
  {
    ...Final,
    ...nextIs(tool("listRefs", { project: PROJECT })),
    rev: Schema.String,
  }
) {}

export class UnknownProposal extends Schema.TaggedError<UnknownProposal>()(
  "UnknownProposal",
  { ...Final, ...nextIs(cli("today")), proposal: ProposalId }
) {}

export class UnknownDiscussion extends Schema.TaggedError<UnknownDiscussion>()(
  "UnknownDiscussion",
  { ...Final, ...nextIs(cli("discussions")), discussion: DiscussionId }
) {}

export class ProjectExists extends Schema.TaggedError<ProjectExists>()(
  "ProjectExists",
  { ...Final, ...nextIs(cli("projects")), project: ProjectName }
) {}

export class NotYourNamespace extends Schema.TaggedError<NotYourNamespace>()(
  "NotYourNamespace",
  { ...Final, handle: Handle, project: ProjectName }
) {
  static readonly of = (project: ProjectName, handle: Handle) =>
    new NotYourNamespace({
      handle,
      next: cli(
        "init",
        "--project",
        `${handle.toLowerCase()}/${shortNameOf(project)}`
      ),
      project,
    });
}

export class ImportFailed extends Schema.TaggedError<ImportFailed>()(
  "ImportFailed",
  {
    ...Retryable,
    ...nextIs(cli("init", "--project", PROJECT, "--import", "<url>")),
    reason: Label,
  }
) {}

export class UnknownEnvItem extends Schema.TaggedError<UnknownEnvItem>()(
  "UnknownEnvItem",
  { ...Final, ...nextIs(cli("env", "shape")), key: EnvKey }
) {}

export class NotSensitive extends Schema.TaggedError<NotSensitive>()(
  "NotSensitive",
  { ...Final, ...nextIs(cli("env", "shape")), key: EnvKey }
) {}

/** Names the minimum only: never the value, nor its length. */
export class ValueTooShort extends Schema.TaggedError<ValueTooShort>()(
  "ValueTooShort",
  { ...Final, key: EnvKey, minimum: Schema.Int }
) {
  static readonly of = (key: EnvKey, minimum: number) =>
    new ValueTooShort({
      key,
      minimum,
      next: cli("env", "set", key, "--acknowledge-short"),
    });

  static readonly belowFloor = (key: EnvKey, minimum: number) =>
    new ValueTooShort({ key, minimum, next: cli("env", "set", key) });
}

const pushAndClaim = [
  NotClaimed,
  ClaimLapsed,
  NotVouched,
  CapReached,
  AskFull,
  NoAsk,
  RepoBusy,
  DirectPush,
  AskBlocked,
  Denounced,
] as const;

// These accumulate, so one push hears about every one at once.
const accumulating = [
  OutOfScope,
  TouchedJudge,
  Weakened,
  PrivatePathInPublicTree,
  ReachedInternals,
] as const;

const merge = [StaleBase, StaleLayer] as const;

const checks = [ChecksFailed, HeldBackFailed, AttemptsExhausted] as const;

const neverCounted = [Flake, VerifierBlocked] as const;

const atAskOpen = [NotRedFirst, WeakCheck, IncompleteBrief] as const;

const maintainersOnly = [
  LayerContentInPublicTree,
  SecretInOutput,
  UnstatedRequirement,
] as const;

const decision = [
  PostureChange,
  NotDecider,
  DecisionClosed,
  ProposalClosed,
  DraftInProgress,
  DiscussionClosed,
] as const;

const lookup = [
  UnknownProject,
  UnknownAsk,
  UnknownCommit,
  UnknownDecision,
  UnknownPath,
  UnknownRevision,
  UnknownProposal,
  UnknownDiscussion,
] as const;

const setup = [ProjectExists, NotYourNamespace, ImportFailed] as const;

const env = [UnknownEnvItem, NotSensitive, ValueTooShort] as const;

export const groups = [
  { members: pushAndClaim, name: "Push and claim" },
  { members: accumulating, name: "Shape" },
  { members: merge, name: "Merge" },
  { members: checks, name: "Checks" },
  { members: neverCounted, name: "Never counted against the answerer" },
  { members: atAskOpen, name: "At ask open" },
  { members: maintainersOnly, name: "Maintainers only" },
  { members: decision, name: "Decision" },
  { members: lookup, name: "Lookup" },
  { members: setup, name: "Setup" },
  { members: env, name: "Env" },
] as const;

/** The closed union. Each member's tag is public: rename one only with an alias. */
export const Refusal = Schema.Union([
  ...pushAndClaim,
  ...accumulating,
  ...merge,
  ...checks,
  ...neverCounted,
  ...atAskOpen,
  ...maintainersOnly,
  ...decision,
  ...lookup,
  ...setup,
  ...env,
]);

export type Refusal = typeof Refusal.Type;
