import { Ask } from "@repo/protocol/domain/ask";
import { AgentTrailer } from "@repo/protocol/domain/credit";
import { Decision } from "@repo/protocol/domain/decision";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { ImportSource } from "@repo/protocol/domain/import";
import { LandingView } from "@repo/protocol/domain/landing";
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

// One schema per table. Each row's encoded side is what the store holds as
// the row's body, so a row reads back exactly as it was written. Lifecycle
// states travel as encoded JSON: the store never decodes them, the project
// service does, with the lifecycles' own schemas.

/**
 * A project: whether it waits for its initializer's first push or is live,
 * the SHA the platform last landed, the policy cached for one landed SHA,
 * and where it was imported from, when it was.
 */
export const ProjectRow = Schema.Struct({
  createdAt: Schema.DateTimeUtcFromString,
  /** The public repo it was imported from; absent for a project that started empty. */
  importedFrom: Schema.optionalKey(ImportSource),
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

/**
 * The held-back suite a claim was pinned to when it opened: the root of
 * the sealed suite and the layer commit that holds it. An answer on the
 * claim is judged by this suite, whatever the layer holds later.
 */
export const PinnedSuite = Schema.Struct({
  at: CommitSha,
  suite: SuiteRoot,
});

export type PinnedSuite = typeof PinnedSuite.Type;

/**
 * One person's claim on an ask, its lifecycle state encoded, and the agents
 * the claimant's pushes to its fork named (their harnesses, as custody heard
 * them), once each in the order they first pushed: what the answer's landing
 * discloses as `Assisted-by:`. Audit metadata, never credit.
 */
export const ClaimRow = Schema.Struct({
  ask: AskId,
  assisted: Schema.optionalKey(Schema.Array(AgentTrailer)),
  claimant: Handle,
  /** The held-back suite pinned when the claim opened; absent when none was sealed. */
  pinned: Schema.optionalKey(PinnedSuite),
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

// The visibility tables. The store keeps them for the visibility ports
// (`visibility-port.ts`, `env-port.ts`); the service reads none of them
// itself, and without the cartridge they stay empty.

/**
 * A layer the project declared: its repo in the private namespace, the
 * layer commit it last admitted with that suite's root and when, a pushed
 * head still waiting on admission, and where the suite's salt is kept. The
 * salt never leaves the project's store: no ledger entry, trailer, note or
 * event carries it.
 */
export const LayerRow = Schema.Struct({
  admittedAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
  landedSha: Schema.optionalKey(CommitSha),
  name: LayerName,
  /** A head pushed to the layer that admission has not let in yet. */
  proposed: Schema.optionalKey(CommitSha),
  repo: RepoName,
  saltRef: Schema.optionalKey(Schema.NonEmptyString),
  suiteRoot: Schema.optionalKey(SuiteRoot),
});

export type LayerRow = typeof LayerRow.Type;

/**
 * How many held-back runs one claimant's answers to one ask failed in one
 * area in one ISO week (`2026-W41`): the per-claim and the per-person,
 * per-area, per-week caps count these. Never a record of the person.
 */
export const AttemptRow = Schema.Struct({
  area: AreaName,
  ask: AskId,
  claimant: Handle,
  count: Schema.Int,
  week: Schema.NonEmptyString,
});

export type AttemptRow = typeof AttemptRow.Type;

/** One entry of the public ledger, numbered by whoever appends it, in order. */
export const LedgerRow = LedgerEntry;

export type LedgerRow = typeof LedgerRow.Type;

/**
 * A write-only value for one `@sensitive` env item: sealed by the vault
 * (the store never reads into it), and who set it, when. Nothing returns
 * the value.
 */
export const EnvValueRow = Schema.Struct({
  key: EnvKey,
  sealed: Schema.Json,
  setAt: Schema.DateTimeUtcFromString,
  setBy: Handle,
});

export type EnvValueRow = typeof EnvValueRow.Type;

/** A read of a layer repo through the gateway, before the store numbers it. */
export const LayerRead = Schema.Struct({
  at: Schema.DateTimeUtcFromString,
  handle: Handle,
  layer: LayerName,
  /** The layer commit the read was served at, when the gateway knew it. */
  sha: Schema.optionalKey(CommitSha),
});

export type LayerRead = typeof LayerRead.Type;

/** A layer read with the number the store gave it: the read log, for the layer's readers. */
export const LayerReadRow = Schema.Struct({
  ...LayerRead.fields,
  seq: Schema.Int,
});

export type LayerReadRow = typeof LayerReadRow.Type;

/** An event with the sequence number the store gave it. */
export const EventRow = Schema.Struct({
  event: ProjectEvent,
  seq: Schema.Int,
});

export type EventRow = typeof EventRow.Type;
