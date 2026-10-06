import { Brand } from "@repo/brand";
import { Effect, Schema } from "effect";

import { AskId, CommitSha, RepoPath } from "./ids.ts";
import { Posture } from "./posture.ts";

const cli = (...args: readonly string[]) => [Brand.cli, ...args].join(" ");

const Label = Schema.NonEmptyString;

const Paths = Schema.NonEmptyArray(RepoPath);

/** Where in the tree a refusal points, when it points at one line. */
const At = Schema.Struct({
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  path: RepoPath,
});

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

/** The pusher already holds as many claims as the project allows. */
export class CapReached extends Schema.TaggedError<CapReached>()("CapReached", {
  ...Retryable,
  ...nextIs(cli("status")),
  cap: Schema.Int,
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

// Merge

/** Main moved past the answer's base; git's `fetch first` and `stale ref` land here too. */
export class StaleBase extends Schema.TaggedError<StaleBase>()("StaleBase", {
  ...Retryable,
  ...nextIs("git pull --rebase"),
  base: CommitSha,
  conflicts: Schema.Array(RepoPath),
  main: CommitSha,
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
) {}

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

// Decision

/** Landing would change the project's posture, which takes a decider. */
export class PostureChange extends Schema.TaggedError<PostureChange>()(
  "PostureChange",
  { ...Final, ...nextIs(cli("today")), from: Posture, to: Posture }
) {}

/** The closed union. Each member's tag is public: rename one only with an alias. */
export const Refusal = Schema.Union([
  // Push and claim
  NotClaimed,
  ClaimLapsed,
  NotVouched,
  CapReached,
  AskFull,
  NoAsk,
  RepoBusy,
  // Shape: these accumulate, so one push hears about every one at once
  OutOfScope,
  TouchedJudge,
  Weakened,
  PrivatePathInPublicTree,
  // Merge
  StaleBase,
  // Checks
  ChecksFailed,
  HeldBackFailed,
  AttemptsExhausted,
  // Never counted against the answerer
  Flake,
  VerifierBlocked,
  // At ask open
  NotRedFirst,
  WeakCheck,
  IncompleteBrief,
  // Maintainers only
  LayerContentInPublicTree,
  SecretInOutput,
  // Decision
  PostureChange,
]);

export type Refusal = typeof Refusal.Type;
