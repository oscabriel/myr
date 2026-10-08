import { ProjectEvent } from "@repo/protocol/domain/event";
import { Array, DateTime, Effect, Option, Schema } from "effect";

import type { ProjectWrites } from "../project-store.ts";
import {
  AnswerRow,
  AskRow,
  AttemptRow,
  BudgetDayRow,
  ClaimRow,
  DecisionRow,
  EnvValueRow,
  LandingRow,
  LayerReadRow,
  LayerRow,
  LedgerRow,
  OutboxRow,
  ProjectRow,
  ProposalRow,
  PushEventRow,
  RatchetRow,
} from "./rows.ts";

// How each kind of row is kept, shared by every adapter: the table it lives
// in, the columns a row is found by, its body (the row's encoded JSON), and
// which tables a commit writes from which `ProjectWrites` field. The SQLite
// tables themselves are created by `migrations.ts`.

/** A column's value: text, or an integer. */
export type Column = string | number;

/** One table's rows: how a row becomes its key columns and body, and back. */
export interface Table<A> {
  /** Every column besides `body`, by name, for one row. */
  readonly columns: (row: A) => Readonly<Record<string, Column>>;
  readonly decode: (body: string) => Effect.Effect<A>;
  readonly encode: (row: A) => Effect.Effect<string>;
  /** The columns that make a row's key: writing a row again under it replaces it. */
  readonly key: readonly string[];
  readonly name: string;
}

// A body that won't encode or decode is a broken invariant, not an outcome a
// caller can handle: it dies, and a commit that dies writes nothing.
const tableOf = <A, I>(
  name: string,
  schema: Schema.Codec<A, I>,
  key: readonly string[],
  columns: (row: A) => Readonly<Record<string, Column>>
): Table<A> => {
  const body = Schema.fromJsonString(schema);
  const encode = Schema.encodeEffect(body);
  const decode = Schema.decodeEffect(body);

  return {
    columns,
    decode: (text) => Effect.orDie(decode(text)),
    encode: (row) => Effect.orDie(encode(row)),
    key,
    name,
  };
};

/** The tables that hold many rows, by the `ProjectWrites` field that carries them. */
export const Tables = {
  answers: tableOf("answers", AnswerRow, ["request_id"], (row) => ({
    request_id: row.requestId,
  })),
  asks: tableOf("asks", AskRow, ["id"], (row) => ({ id: row.id })),
  attempts: tableOf(
    "attempts",
    AttemptRow,
    ["ask", "claimant", "area", "week"],
    (row) => ({
      area: row.area,
      ask: row.ask,
      claimant: row.claimant,
      week: row.week,
    })
  ),
  budgetDays: tableOf(
    "budget_days",
    BudgetDayRow,
    ["decider", "day"],
    (row) => ({ day: row.day, decider: row.decider })
  ),
  claims: tableOf("claims", ClaimRow, ["ask", "claimant"], (row) => ({
    ask: row.ask,
    claimant: row.claimant,
  })),
  decisions: tableOf("decisions", DecisionRow, ["id"], (row) => ({
    id: row.id,
  })),
  envValues: tableOf("env_values", EnvValueRow, ["key"], (row) => ({
    key: row.key,
  })),
  landings: tableOf("landings", LandingRow, ["sha"], (row) => ({
    landed_at: DateTime.toEpochMillis(row.landedAt),
    sha: row.sha,
  })),
  layers: tableOf("layers", LayerRow, ["name"], (row) => ({ name: row.name })),
  ledger: tableOf("ledger", LedgerRow, ["seq"], (row) => ({
    at: DateTime.toEpochMillis(row.at),
    seq: row.seq,
  })),
  outbox: tableOf("outbox", OutboxRow, ["id"], (row) => ({ id: row.id })),
  proposals: tableOf("proposals", ProposalRow, ["id"], (row) => ({
    id: row.id,
  })),
  pushEvents: tableOf("push_events", PushEventRow, ["event_id"], (row) => ({
    event_id: row.eventId,
  })),
  ratchets: tableOf(
    "ratchets",
    RatchetRow,
    ["ratchet", "territory"],
    (row) => ({ ratchet: row.ratchet, territory: row.territory })
  ),
} as const;

/** A table with one row at most: the project, and the landing queue. */
const single = { id: 1 } as const;

/** The project's own row. */
export const ProjectTable = tableOf(
  "project",
  ProjectRow,
  ["id"],
  () => single
);

/** The encoded landing queue, one row. */
export const QueueTable = tableOf(
  "landing_queue",
  Schema.Json,
  ["id"],
  () => single
);

/** The project's events, each body carrying the `seq` it was given. */
export const EventTable = tableOf("events", ProjectEvent, ["seq"], (event) => ({
  seq: event.seq,
}));

/** The layer read log, each body carrying the `seq` it was given. */
export const LayerReadTable = tableOf(
  "layer_reads",
  LayerReadRow,
  ["seq"],
  (read) => ({ at: DateTime.toEpochMillis(read.at), seq: read.seq })
);

/** How an adapter writes one table's rows, each replacing any row under its key. */
export type Upsert<E, R> = <A>(
  table: Table<A>,
  rows: readonly A[]
) => Effect.Effect<void, E, R>;

/** The newest numbers a store gave: its last event's, and its last layer read's. */
export interface LastNumbers {
  readonly read: number;
  readonly seq: number;
}

/**
 * Writes every row in `writes` through an adapter's `upsert`, table by
 * table, with the events numbered on from `last.seq` and the layer reads
 * from `last.read`, and returns the numbers it gave the events. Both
 * adapters commit through it, so a table `ProjectWrites` gains is written by
 * both or by neither.
 */
export const writeAll = <E, R>(
  writes: ProjectWrites,
  last: LastNumbers,
  upsert: Upsert<E, R>
): Effect.Effect<readonly number[], E, R> =>
  Effect.gen(function* () {
    const events = Array.map(writes.events ?? [], (event, index) => ({
      ...event,
      seq: last.seq + index + 1,
    }));

    const reads = Array.map(writes.layerReads ?? [], (read, index) => ({
      ...read,
      seq: last.read + index + 1,
    }));

    yield* upsert(
      ProjectTable,
      Option.toArray(Option.fromUndefinedOr(writes.project))
    );
    yield* upsert(Tables.asks, writes.asks ?? []);
    yield* upsert(Tables.claims, writes.claims ?? []);
    yield* upsert(Tables.answers, writes.answers ?? []);
    yield* upsert(QueueTable, writes.queue === undefined ? [] : [writes.queue]);
    yield* upsert(Tables.landings, writes.landings ?? []);
    yield* upsert(Tables.proposals, writes.proposals ?? []);
    yield* upsert(Tables.decisions, writes.decisions ?? []);
    yield* upsert(Tables.budgetDays, writes.budgetDays ?? []);
    yield* upsert(Tables.ratchets, writes.ratchets ?? []);
    yield* upsert(Tables.pushEvents, writes.pushEvents ?? []);
    yield* upsert(EventTable, events);
    yield* upsert(Tables.outbox, writes.outbox ?? []);
    yield* upsert(Tables.layers, writes.layers ?? []);
    yield* upsert(Tables.attempts, writes.attempts ?? []);
    yield* upsert(Tables.ledger, writes.ledger ?? []);
    yield* upsert(Tables.envValues, writes.envValues ?? []);
    yield* upsert(LayerReadTable, reads);

    return Array.map(events, (event) => event.seq);
  });
