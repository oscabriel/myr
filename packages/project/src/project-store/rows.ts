import { Ask } from "@repo/protocol/domain/ask";
import { AgentTrailer } from "@repo/protocol/domain/credit";
import { Decision } from "@repo/protocol/domain/decision";
import { Discussion } from "@repo/protocol/domain/discussion";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { LandingView } from "@repo/protocol/domain/landing";
import { ImportSource } from "@repo/protocol/domain/policy";
import { Proposal } from "@repo/protocol/domain/proposal";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import {
  AreaName,
  AskId,
  CommitSha,
  EnvKey,
  Handle,
  LandedSha,
  LayerName,
  ProjectName,
  RatchetName,
  RepoName,
  RequestId,
  SuiteRoot,
} from "@repo/protocol/ids";
import { Schema } from "effect";

// Lifecycle states travel as encoded JSON: the store never decodes them.

export const ProjectRow = Schema.Struct({
  createdAt: Schema.DateTimeUtcFromString,
  importedFrom: Schema.optionalKey(ImportSource),
  initializer: Handle,
  landed: Schema.optionalKey(LandedSha),
  policy: Schema.optionalKey(Schema.Json),
  policyAt: Schema.optionalKey(LandedSha),
  project: ProjectName,
  state: Schema.Literals(["awaitingFirstPush", "live"]),
});

export type ProjectRow = typeof ProjectRow.Type;

export const AskRow = Ask;

export type AskRow = typeof AskRow.Type;

/** An answer on the claim is judged by this suite, whatever the layer holds later. */
export const PinnedSuite = Schema.Struct({
  at: CommitSha,
  suite: SuiteRoot,
});

export type PinnedSuite = typeof PinnedSuite.Type;

/** `agents` is audit metadata (`Assisted-by:`), never credit. */
export const ClaimRow = Schema.Struct({
  ask: AskId,
  assisted: Schema.optionalKey(Schema.Array(AgentTrailer)),
  claimant: Handle,
  pinned: Schema.optionalKey(PinnedSuite),
  state: Schema.Json,
  updatedAt: Schema.DateTimeUtcFromString,
});

export type ClaimRow = typeof ClaimRow.Type;

/** Keyed by `requestId`, so a request sent twice is one row. */
export const AnswerRow = Schema.Struct({
  answerer: Handle,
  ask: Schema.optionalKey(AskId),
  head: CommitSha,
  requestId: RequestId,
  state: Schema.Json,
  updatedAt: Schema.DateTimeUtcFromString,
});

export type AnswerRow = typeof AnswerRow.Type;

export const LandingRow = LandingView;

export type LandingRow = typeof LandingRow.Type;

export const ProposalRow = Proposal;

export type ProposalRow = typeof ProposalRow.Type;

export const DecisionRow = Decision;

export type DecisionRow = typeof DecisionRow.Type;

export const DiscussionRow = Discussion;

export type DiscussionRow = typeof DiscussionRow.Type;

export const BudgetDayRow = Schema.Struct({
  day: Schema.String,
  decider: Handle,
  finishes: Schema.Int,
  used: Schema.Int,
});

export type BudgetDayRow = typeof BudgetDayRow.Type;

export const RatchetRow = Schema.Struct({
  at: LandedSha,
  count: Schema.Int,
  ratchet: RatchetName,
  territory: Schema.NonEmptyString,
});

export type RatchetRow = typeof RatchetRow.Type;

/** Keyed by event id: events arrive per ref and may repeat. */
export const PushEventRow = Schema.Struct({
  after: Schema.optionalKey(CommitSha),
  at: Schema.DateTimeUtcFromString,
  before: Schema.optionalKey(CommitSha),
  eventId: Schema.NonEmptyString,
  ref: Schema.NonEmptyString,
  repo: RepoName,
});

export type PushEventRow = typeof PushEventRow.Type;

export const OutboxRow = Schema.Struct({
  attempts: Schema.Int,
  body: Schema.Json,
  id: Schema.NonEmptyString,
  kind: Schema.NonEmptyString,
  notBefore: Schema.DateTimeUtcFromString,
});

export type OutboxRow = typeof OutboxRow.Type;

/** The salt never leaves the project's store: no ledger entry, trailer, note or event carries it. */
export const LayerRow = Schema.Struct({
  admittedAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
  landedSha: Schema.optionalKey(CommitSha),
  name: LayerName,
  proposed: Schema.optionalKey(CommitSha),
  repo: RepoName,
  saltRef: Schema.optionalKey(Schema.NonEmptyString),
  suiteRoot: Schema.optionalKey(SuiteRoot),
});

export type LayerRow = typeof LayerRow.Type;

/** Never a record of the person. */
export const AttemptRow = Schema.Struct({
  area: AreaName,
  ask: AskId,
  claimant: Handle,
  count: Schema.Int,
  week: Schema.NonEmptyString,
});

export type AttemptRow = typeof AttemptRow.Type;

export const LedgerRow = LedgerEntry;

export type LedgerRow = typeof LedgerRow.Type;

/** Sealed by the vault; nothing returns the value. */
export const EnvValueRow = Schema.Struct({
  key: EnvKey,
  sealed: Schema.Json,
  setAt: Schema.DateTimeUtcFromString,
  setBy: Handle,
});

export type EnvValueRow = typeof EnvValueRow.Type;

export const LayerRead = Schema.Struct({
  at: Schema.DateTimeUtcFromString,
  handle: Handle,
  layer: LayerName,
  sha: Schema.optionalKey(CommitSha),
});

export type LayerRead = typeof LayerRead.Type;

export const LayerReadRow = Schema.Struct({
  ...LayerRead.fields,
  seq: Schema.Int,
});

export type LayerReadRow = typeof LayerReadRow.Type;

export const EventRow = Schema.Struct({
  event: ProjectEvent,
  seq: Schema.Int,
});

export type EventRow = typeof EventRow.Type;
