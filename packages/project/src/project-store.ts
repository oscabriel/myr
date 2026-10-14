import type { CommitSha } from "@repo/protocol/ids";
import { Context } from "effect";
import type { Effect, Option, Schema } from "effect";

import type { ProjectEventInput } from "./events.ts";
import type {
  AnswerRow,
  AskRow,
  AttemptRow,
  ClaimRow,
  DecisionRow,
  DiscussionRow,
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

export const snapshotLandings = 50;

/** How many events a project keeps; a watcher resuming from an older one has missed some. */
export const keptEvents = 500;

export interface ProjectSnapshot {
  readonly answers: readonly AnswerRow[];
  readonly asks: readonly AskRow[];
  readonly attempts: readonly AttemptRow[];
  readonly claims: readonly ClaimRow[];
  readonly decisions: readonly DecisionRow[];
  readonly discussions: readonly DiscussionRow[];
  readonly envValues: readonly EnvValueRow[];
  readonly landings: readonly LandingRow[];
  readonly lastSeq: number;
  readonly layers: readonly LayerRow[];
  readonly ledger: readonly LedgerRow[];
  readonly outbox: readonly OutboxRow[];
  readonly project: Option.Option<ProjectRow>;
  readonly proposals: readonly ProposalRow[];
  readonly queue: Schema.Json;
  readonly ratchets: readonly RatchetRow[];
}

export interface ProjectWrites {
  readonly answers?: readonly AnswerRow[];
  readonly asks?: readonly AskRow[];
  readonly attempts?: readonly AttemptRow[];
  readonly claims?: readonly ClaimRow[];
  readonly decisions?: readonly DecisionRow[];
  readonly discussions?: readonly DiscussionRow[];
  readonly envValues?: readonly EnvValueRow[];
  readonly events?: readonly ProjectEventInput[];
  readonly landings?: readonly LandingRow[];
  readonly layerReads?: readonly LayerRead[];
  readonly layers?: readonly LayerRow[];
  readonly ledger?: readonly LedgerRow[];
  readonly outbox?: readonly OutboxRow[];
  readonly project?: ProjectRow;
  readonly proposals?: readonly ProposalRow[];
  readonly pushEvents?: readonly PushEventRow[];
  readonly queue?: Schema.Json;
  readonly ratchets?: readonly RatchetRow[];
}

export interface Committed {
  /** Event ids already stored. When there is one, the commit wrote nothing. */
  readonly duplicatePushEvents: readonly string[];
  readonly seqs: readonly number[];
}

/**
 * `commit` is all or nothing, so a crash between calls never leaves half a
 * transition. A commit carrying a push event already stored is a replay: it
 * writes nothing and lists the ids it had seen. Store failures are defects.
 */
export class ProjectStore extends Context.Service<
  ProjectStore,
  {
    /**
     * Takes out the outbox rows it still holds of `ids`, and names them: of
     * two acks of one row, only the first takes it.
     */
    readonly ackOutbox: (
      ids: readonly string[]
    ) => Effect.Effect<readonly string[]>;
    readonly commit: (writes: ProjectWrites) => Effect.Effect<Committed>;
    readonly eventsSince: (
      seq: number,
      limit: number
    ) => Effect.Effect<readonly EventRow[]>;
    readonly landing: (
      sha: CommitSha
    ) => Effect.Effect<Option.Option<LandingRow>>;
    /** Every landing the project keeps, past the snapshot's newest. */
    readonly landingCount: () => Effect.Effect<number>;
    readonly layerReadsSince: (
      seq: number,
      limit: number
    ) => Effect.Effect<readonly LayerReadRow[]>;
    readonly load: () => Effect.Effect<ProjectSnapshot>;
  }
>()("project/ProjectStore") {}
