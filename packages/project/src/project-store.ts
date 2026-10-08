import type { CommitSha } from "@repo/protocol/ids";
import { Context } from "effect";
import type { Effect, Option, Schema } from "effect";

import type { ProjectEventInput } from "./events.ts";
import type {
  AnswerRow,
  AskRow,
  AttemptRow,
  BudgetDayRow,
  ClaimRow,
  DecisionRow,
  EnvValueRow,
  EventRow,
  LandingRow,
  LayerRead,
  LayerReadRow,
  LayerRow,
  LedgerRow,
  OutboxRow,
  ProjectRow,
  ProposalRow,
  PushEventRow,
  RatchetRow,
} from "./project-store/rows.ts";

/** How many landings a snapshot carries, newest first; `landing` finds older ones. */
export const snapshotLandings = 50;

/** How many events a project keeps; a watcher resuming from an older one has missed some. */
export const keptEvents = 500;

/**
 * A project's whole working state, read in one go at the start of a call
 * (hydrate). Rows come back in the order they were first written, except
 * `landings`.
 */
export interface ProjectSnapshot {
  readonly answers: readonly AnswerRow[];
  readonly asks: readonly AskRow[];
  /** Failed held-back runs per claim, area and week. */
  readonly attempts: readonly AttemptRow[];
  readonly budgetDays: readonly BudgetDayRow[];
  readonly claims: readonly ClaimRow[];
  readonly decisions: readonly DecisionRow[];
  /** Write-only values, sealed, by env key. */
  readonly envValues: readonly EnvValueRow[];
  /** The newest `snapshotLandings` landings, newest first. */
  readonly landings: readonly LandingRow[];
  /** The sequence number of the newest event, or 0 before the first. */
  readonly lastSeq: number;
  /** The layers the project declared. */
  readonly layers: readonly LayerRow[];
  /** The public ledger, every entry. */
  readonly ledger: readonly LedgerRow[];
  /** Side effects not yet acknowledged, in the order they were written. */
  readonly outbox: readonly OutboxRow[];
  /** Absent until the project is initialized. */
  readonly project: Option.Option<ProjectRow>;
  readonly proposals: readonly ProposalRow[];
  /** The encoded landing queue; `null` until a commit writes one. */
  readonly queue: Schema.Json;
  readonly ratchets: readonly RatchetRow[];
}

/**
 * What one call changed. Every row is an upsert by its table's key (an ask
 * by id, a claim by ask and claimant, an answer by `requestId`, a landing by
 * SHA, an outbox entry by id, a layer by name, an attempt by ask, claimant,
 * area and week, a ledger entry by `seq`, a value by its key); `events` and
 * `layerReads` are appended and numbered.
 */
export interface ProjectWrites {
  readonly answers?: readonly AnswerRow[];
  readonly asks?: readonly AskRow[];
  readonly attempts?: readonly AttemptRow[];
  readonly budgetDays?: readonly BudgetDayRow[];
  readonly claims?: readonly ClaimRow[];
  readonly decisions?: readonly DecisionRow[];
  readonly envValues?: readonly EnvValueRow[];
  readonly events?: readonly ProjectEventInput[];
  readonly landings?: readonly LandingRow[];
  /** Appended to the read log and numbered, as events are. */
  readonly layerReads?: readonly LayerRead[];
  readonly layers?: readonly LayerRow[];
  /** Upserted by `seq`: the ledger's writer numbers its entries. */
  readonly ledger?: readonly LedgerRow[];
  readonly outbox?: readonly OutboxRow[];
  readonly project?: ProjectRow;
  readonly proposals?: readonly ProposalRow[];
  readonly pushEvents?: readonly PushEventRow[];
  readonly queue?: Schema.Json;
  readonly ratchets?: readonly RatchetRow[];
}

/** What a commit did: the numbers it gave its events, and the push events it had already seen. */
export interface Committed {
  /** Event ids already stored. When there is one, the commit wrote nothing. */
  readonly duplicatePushEvents: readonly string[];
  /** One per event written, in order. */
  readonly seqs: readonly number[];
}

/**
 * One project's state, hydrated and persisted per call (ADR 0012): `load`
 * reads the whole working state, `commit` writes every row, outbox entry and
 * event a transition produced in one transaction, so a crash between two
 * calls never leaves half a transition.
 *
 * - `commit` is all or nothing. A commit that carries a push event already
 *   stored is a replay: it writes nothing, numbers no event, and lists the
 *   ids it had seen, so acting on one push event twice is a no-op.
 * - Events are numbered from 1 in commit order; only the newest `keptEvents`
 *   are kept, which `eventsSince` reads for a watcher resuming from a number.
 * - `ackOutbox` drops entries the settle step ran; unknown ids are ignored.
 * - `landing` finds a landing by SHA, older than the snapshot's too.
 * - Layer reads are numbered from 1 in commit order and all kept; they are
 *   no part of the snapshot, and `layerReadsSince` reads them.
 * - The store reads no clock: every timestamp arrives in a row.
 *
 * Store failures are defects, not errors: a project whose storage fails can
 * do nothing useful, and the platform's error boundary reports it.
 */
export class ProjectStore extends Context.Service<
  ProjectStore,
  {
    readonly ackOutbox: (ids: readonly string[]) => Effect.Effect<void>;
    readonly commit: (writes: ProjectWrites) => Effect.Effect<Committed>;
    readonly eventsSince: (
      seq: number,
      limit: number
    ) => Effect.Effect<readonly EventRow[]>;
    readonly landing: (
      sha: CommitSha
    ) => Effect.Effect<Option.Option<LandingRow>>;
    readonly layerReadsSince: (
      seq: number,
      limit: number
    ) => Effect.Effect<readonly LayerReadRow[]>;
    readonly load: () => Effect.Effect<ProjectSnapshot>;
  }
>()("project/ProjectStore") {}
