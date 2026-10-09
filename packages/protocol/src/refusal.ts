import { Brand } from "@repo/brand";
import { Effect, Schema } from "effect";

import { At } from "./domain/common.ts";
import {
  AskId,
  CommitSha,
  DecisionId,
  EnvKey,
  ProjectName,
  ProposalId,
  RepoPath,
} from "./ids.ts";
import { Posture } from "./posture.ts";

/** Where in the tree a refusal points, when it points at one line. */
export { At } from "./domain/common.ts";

const cli = (...args: readonly string[]) => [Brand.cli, ...args].join(" ");

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

/** A `next` that needs no ids, so the constructor fills it in. */
const nextIs = (command: string) => ({
  next: Schema.NonEmptyString.pipe(
    Schema.withConstructorDefault(Effect.succeed(command))
  ),
});

// Push and claim

/** The pusher holds no claim on the ask. */
export class NotClaimed extends Schema.TaggedError<NotClaimed>()("NotClaimed", {
  ...Retryable,
  ask: AskId,
}) {
  static readonly of = (ask: AskId) =>
    new NotClaimed({ ask, next: cli("claim", ask) });
}

/** The claim expired before this push. */
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

/** No member of the project has vouched for the pusher. */
export class NotVouched extends Schema.TaggedError<NotVouched>()("NotVouched", {
  ...Final,
  ...nextIs(cli("status")),
}) {}

/**
 * The caller reached a limit of `cap`. `limit` says which: claims held (also
 * when absent, the first meaning, so a claim cap needs no key), open
 * proposals, or a proposal's draft rounds. A rate limit across the platform
 * also gives `retryAfter`, the seconds until one more is let through; a cap
 * without it lifts when something held is released, landed or decided.
 */
export class CapReached extends Schema.TaggedError<CapReached>()("CapReached", {
  ...Retryable,
  ...nextIs(cli("status")),
  cap: Schema.Int,
  /** Which limit: claims held (also when absent), proposals, or drafts. */
  limit: Schema.optionalKey(Schema.Literals(["claims", "proposals", "drafts"])),
  /** For a rate limit: seconds until one more is let through. */
  retryAfter: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
  ),
}) {}

/** Someone else holds the ask's one claim. */
export class AskFull extends Schema.TaggedError<AskFull>()("AskFull", {
  ...Retryable,
  ...nextIs(cli("asks")),
  ask: AskId,
}) {}

/** The push names no open ask. */
export class NoAsk extends Schema.TaggedError<NoAsk>()("NoAsk", {
  ...Final,
  ...nextIs(cli("asks")),
}) {}

/** The repo's storage was busy with another push. */
export class RepoBusy extends Schema.TaggedError<RepoBusy>()("RepoBusy", {
  ...Retryable,
  ...nextIs("git push"),
}) {}

/**
 * The push tried to move a ref the pusher may not move: a canonical ref
 * (main moves only by a landing; an answer goes to the claim's fork), or, on
 * a fork, a ref outside `refs/heads/`, which the platform writes itself.
 */
export class DirectPush extends Schema.TaggedError<DirectPush>()("DirectPush", {
  ...Final,
  ...nextIs(cli("asks")),
  ref: Label,
}) {}

/** The ask waits on other asks to land first, as the delete step of a migrate does. */
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

/** The project's vouch file denounces the caller, so it takes no claims or proposals from them. */
export class Denounced extends Schema.TaggedError<Denounced>()("Denounced", {
  ...Final,
  ...nextIs(cli("status")),
}) {}

// Shape: these accumulate, so one push hears about every one at once

/** The answer changes paths outside the ask's territory. */
export class OutOfScope extends Schema.TaggedError<OutOfScope>()("OutOfScope", {
  ...Final,
  ...nextIs(cli("check")),
  paths: Paths,
}) {}

/** The answer changes the judge closure. */
export class TouchedJudge extends Schema.TaggedError<TouchedJudge>()(
  "TouchedJudge",
  {
    ...Final,
    ...nextIs(cli("check")),
    paths: Paths,
  }
) {}

/** The answer adds a marker that disables a check, or raises a ratchet. */
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

/** The answer's tree would put held-back paths on main. */
export class PrivatePathInPublicTree extends Schema.TaggedError<PrivatePathInPublicTree>()(
  "PrivatePathInPublicTree",
  { ...Final, ...nextIs(cli("check")), paths: Paths }
) {}

/**
 * The answer imports another module's internals: a file that module does not
 * export. `to` is what the import names.
 */
export class ReachedInternals extends Schema.TaggedError<ReachedInternals>()(
  "ReachedInternals",
  { ...Final, ...nextIs(cli("check")), from: RepoPath, to: Label }
) {}

// Merge

/** Main moved past the answer's base; git's `fetch first` and `stale ref` land here too. */
export class StaleBase extends Schema.TaggedError<StaleBase>()("StaleBase", {
  ...Retryable,
  ...nextIs("git pull --rebase"),
  base: CommitSha,
  conflicts: Schema.Array(RepoPath),
  main: CommitSha,
}) {}

/**
 * A layer the answer was checked with moved since; the answer is checked
 * again against it, as a moved main is.
 */
export class StaleLayer extends Schema.TaggedError<StaleLayer>()("StaleLayer", {
  ...Retryable,
  ...nextIs(cli("status")),
  layer: Label,
}) {}

// Checks

/** A check failed; `next` is the command that reproduces it. */
export class ChecksFailed extends Schema.TaggedError<ChecksFailed>()(
  "ChecksFailed",
  {
    ...Final,
    lane: Label,
    logRef: Label,
  }
) {
  /**
   * The `logRef` of a lane whose log held a stored write-only value: the log
   * was never kept, and nothing names the item.
   */
  static readonly withheld = "withheld";
}

/** A held-back check failed; only its area and suite are disclosed. */
export class HeldBackFailed extends Schema.TaggedError<HeldBackFailed>()(
  "HeldBackFailed",
  { ...Final, ...nextIs(cli("status")), area: Label, suite: Label }
) {}

/** The pusher used every attempt on an area's held-back checks for now. */
export class AttemptsExhausted extends Schema.TaggedError<AttemptsExhausted>()(
  "AttemptsExhausted",
  {
    ...Retryable,
    ...nextIs(cli("status")),
    area: Label,
    resetsAt: Schema.DateTimeUtcFromString,
  }
) {}

// Never counted against the answerer

/** A check failed and then passed on the same tree; the platform retries it. */
export class Flake extends Schema.TaggedError<Flake>()("Flake", {
  ...Retryable,
  ...nextIs(cli("status")),
  lane: Label,
}) {}

/** The platform could not run the checks. */
export class VerifierBlocked extends Schema.TaggedError<VerifierBlocked>()(
  "VerifierBlocked",
  { ...Retryable, ...nextIs(cli("status")) }
) {}

// At ask open

/** The ask's check does not fail on main twice in the same way, by an assertion. */
export class NotRedFirst extends Schema.TaggedError<NotRedFirst>()(
  "NotRedFirst",
  {
    ...Final,
    ...nextIs(cli("check")),
  }
) {}

/** The ask's check would pass a trivial answer. */
export class WeakCheck extends Schema.TaggedError<WeakCheck>()("WeakCheck", {
  ...Final,
  ...nextIs(cli("check")),
  weakness: Label,
}) {}

/** The ask's brief leaves out fields its kind requires. */
export class IncompleteBrief extends Schema.TaggedError<IncompleteBrief>()(
  "IncompleteBrief",
  { ...Final, ...nextIs(cli("check")), missing: Schema.NonEmptyArray(Label) }
) {}

// Maintainers only

/** A layer's files would enter a public tree. */
export class LayerContentInPublicTree extends Schema.TaggedError<LayerContentInPublicTree>()(
  "LayerContentInPublicTree",
  { ...Final, ...nextIs(cli("check")), paths: Paths }
) {}

/** A write-only value showed up in output or in the tree. */
export class SecretInOutput extends Schema.TaggedError<SecretInOutput>()(
  "SecretInOutput",
  {
    ...Final,
    ...nextIs(cli("check")),
    item: Label,
    where: Schema.Literals(["output", "tree"]),
  }
) {}

/**
 * A held-back check in this area enforces something no public clause states,
 * so it cannot enter the suite: a sealed check must cite what it holds.
 */
export class UnstatedRequirement extends Schema.TaggedError<UnstatedRequirement>()(
  "UnstatedRequirement",
  { ...Final, ...nextIs(cli("check")), area: Label }
) {}

// Decision

/** Landing would change the project's posture, which takes a decider. */
export class PostureChange extends Schema.TaggedError<PostureChange>()(
  "PostureChange",
  { ...Final, ...nextIs(cli("today")), from: Posture, to: Posture }
) {}

/** Only one of the project's deciders may do this. */
export class NotDecider extends Schema.TaggedError<NotDecider>()("NotDecider", {
  ...Final,
  ...nextIs(cli("status")),
}) {}

/** The decision was already taken, or expired to its default. */
export class DecisionClosed extends Schema.TaggedError<DecisionClosed>()(
  "DecisionClosed",
  { ...Final, ...nextIs(cli("today")), decision: DecisionId }
) {}

/** The proposal was accepted, declined or expired, so nothing more is drafted for it. */
export class ProposalClosed extends Schema.TaggedError<ProposalClosed>()(
  "ProposalClosed",
  { ...Final, ...nextIs(cli("today")), proposal: ProposalId }
) {}

/** The platform is drafting this proposal's ask already; its page says when it settles. */
export class DraftInProgress extends Schema.TaggedError<DraftInProgress>()(
  "DraftInProgress",
  { ...Retryable, proposal: ProposalId }
) {
  static readonly of = (proposal: ProposalId) =>
    new DraftInProgress({ next: cli("proposal", proposal), proposal });
}

// Lookup

/** No project has this name. */
export class UnknownProject extends Schema.TaggedError<UnknownProject>()(
  "UnknownProject",
  { ...Final, ...nextIs(cli("asks")), project: ProjectName }
) {}

/** The project has no ask with this name. */
export class UnknownAsk extends Schema.TaggedError<UnknownAsk>()("UnknownAsk", {
  ...Final,
  ...nextIs(cli("asks")),
  ask: AskId,
}) {}

/** The project has no commit with this id. */
export class UnknownCommit extends Schema.TaggedError<UnknownCommit>()(
  "UnknownCommit",
  { ...Final, ...nextIs("git fetch"), sha: CommitSha }
) {}

/** The project has no decision with this id. */
export class UnknownDecision extends Schema.TaggedError<UnknownDecision>()(
  "UnknownDecision",
  { ...Final, ...nextIs(cli("today")), decision: DecisionId }
) {}

/**
 * The project has no file or folder at this path at this commit. The
 * commit is `commit`: `at` points at a line, as on every refusal.
 */
export class UnknownPath extends Schema.TaggedError<UnknownPath>()(
  "UnknownPath",
  { ...Final, ...nextIs("git ls-tree"), commit: CommitSha, path: RepoPath }
) {}

/** Neither `main`, a commit the project holds, nor one of its tags. */
export class UnknownRevision extends Schema.TaggedError<UnknownRevision>()(
  "UnknownRevision",
  { ...Final, ...nextIs("git ls-remote"), rev: Schema.String }
) {}

/** The project has no proposal with this id. */
export class UnknownProposal extends Schema.TaggedError<UnknownProposal>()(
  "UnknownProposal",
  { ...Final, ...nextIs(cli("today")), proposal: ProposalId }
) {}

// Setup

/** A project with this name already exists. */
export class ProjectExists extends Schema.TaggedError<ProjectExists>()(
  "ProjectExists",
  { ...Final, ...nextIs(cli("asks")), project: ProjectName }
) {}

/** The repo to import could not be read; `reason` says what went wrong. */
export class ImportFailed extends Schema.TaggedError<ImportFailed>()(
  "ImportFailed",
  { ...Retryable, ...nextIs(cli("init")), reason: Label }
) {}

// Env

/** The project's env shape has no item with this key. */
export class UnknownEnvItem extends Schema.TaggedError<UnknownEnvItem>()(
  "UnknownEnvItem",
  { ...Final, ...nextIs(cli("env", "shape")), key: EnvKey }
) {}

/** Only an `@sensitive` env item holds a write-only value, and this one is not. */
export class NotSensitive extends Schema.TaggedError<NotSensitive>()(
  "NotSensitive",
  { ...Final, ...nextIs(cli("env", "shape")), key: EnvKey }
) {}

/**
 * The value is shorter than the item asks for. The refusal names the minimum
 * only: never the value, and never its length.
 */
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

  /** Shorter than the floor no acknowledgement lifts: the next step is another value. */
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
] as const;

const lookup = [
  UnknownProject,
  UnknownAsk,
  UnknownCommit,
  UnknownDecision,
  UnknownPath,
  UnknownRevision,
  UnknownProposal,
] as const;

const setup = [ProjectExists, ImportFailed] as const;

const env = [UnknownEnvItem, NotSensitive, ValueTooShort] as const;

/**
 * The union's members by group, in union order. The reference docs file each
 * refusal under its group; a new refusal joins its group here and in the union.
 */
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
