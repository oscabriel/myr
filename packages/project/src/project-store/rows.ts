import { Ask } from "@repo/protocol/domain/ask";
import { Decision } from "@repo/protocol/domain/decision";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { LandingView } from "@repo/protocol/domain/landing";
import { Proposal } from "@repo/protocol/domain/proposal";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RatchetName,
  RepoName,
  RequestId,
} from "@repo/protocol/ids";
import { Schema } from "effect";

// One schema per table. Each row's encoded side is what the store holds as
// the row's body, so a row reads back exactly as it was written. Lifecycle
// states travel as encoded JSON: the store never decodes them, the project
// service does, with the lifecycles' own schemas.

/**
 * A project: whether it waits for its initializer's first push or is live,
 * the SHA the platform last landed, and the policy cached for one landed SHA.
 */
export const ProjectRow = Schema.Struct({
  createdAt: Schema.DateTimeUtcFromString,
  initializer: Handle,
  landed: Schema.optionalKey(LandedSha),
  /** The encoded `Policy` evaluated at `policyAt`. */
  policy: Schema.optionalKey(Schema.Json),
  policyAt: Schema.optionalKey(LandedSha),
  project: ProjectName,
  state: Schema.Literals(["awaitingFirstPush", "live"]),
});

export type ProjectRow = typeof ProjectRow.Type;

/** An ask, as the domain types it. */
export const AskRow = Ask;

export type AskRow = typeof AskRow.Type;

/** One person's claim on an ask, its lifecycle state encoded. */
export const ClaimRow = Schema.Struct({
  ask: AskId,
  claimant: Handle,
  /** The encoded claim lifecycle state. */
  state: Schema.Json,
  updatedAt: Schema.DateTimeUtcFromString,
});

export type ClaimRow = typeof ClaimRow.Type;

/**
 * One answer request, keyed by its `requestId` so a request sent twice is
 * one row; where it stands, encoded.
 */
export const AnswerRow = Schema.Struct({
  answerer: Handle,
  ask: Schema.optionalKey(AskId),
  head: CommitSha,
  requestId: RequestId,
  /**
   * The service's `AnswerRecord` (`src/project.ts`), encoded: the landing
   * lifecycle's state, the receipt the request was first given, and the
   * verdict on its last checked tree. The store keeps it as one JSON value.
   */
  state: Schema.Json,
  updatedAt: Schema.DateTimeUtcFromString,
});

export type AnswerRow = typeof AnswerRow.Type;

/** A landing, as the domain types it. */
export const LandingRow = LandingView;

export type LandingRow = typeof LandingRow.Type;

/** A proposal, as the domain types it. */
export const ProposalRow = Proposal;

export type ProposalRow = typeof ProposalRow.Type;

/** A decision, as the domain types it. */
export const DecisionRow = Decision;

export type DecisionRow = typeof DecisionRow.Type;

/** How much of one decider's budget one day used, and how many finishes. */
export const BudgetDayRow = Schema.Struct({
  /** `YYYY-MM-DD`, in UTC. */
  day: Schema.String,
  decider: Handle,
  finishes: Schema.Int,
  used: Schema.Int,
});

export type BudgetDayRow = typeof BudgetDayRow.Type;

/** A ratchet's count in one territory, as recorded at a landing. */
export const RatchetRow = Schema.Struct({
  at: LandedSha,
  count: Schema.Int,
  ratchet: RatchetName,
  territory: Schema.NonEmptyString,
});

export type RatchetRow = typeof RatchetRow.Type;

/**
 * A push the project heard about, kept by its event id so the same event
 * heard twice is acted on once (events arrive per ref, and may repeat).
 */
export const PushEventRow = Schema.Struct({
  after: Schema.optionalKey(CommitSha),
  at: Schema.DateTimeUtcFromString,
  before: Schema.optionalKey(CommitSha),
  eventId: Schema.NonEmptyString,
  ref: Schema.NonEmptyString,
  repo: RepoName,
});

export type PushEventRow = typeof PushEventRow.Type;

/**
 * A side effect still to run after its transition was persisted (a fork, a
 * projection row), kept until it is acknowledged.
 */
export const OutboxRow = Schema.Struct({
  attempts: Schema.Int,
  body: Schema.Json,
  id: Schema.NonEmptyString,
  kind: Schema.NonEmptyString,
  notBefore: Schema.DateTimeUtcFromString,
});

export type OutboxRow = typeof OutboxRow.Type;

/** An event with the sequence number the store gave it. */
export const EventRow = Schema.Struct({
  event: ProjectEvent,
  seq: Schema.Int,
});

export type EventRow = typeof EventRow.Type;
