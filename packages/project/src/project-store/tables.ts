import { ProjectEvent } from "@repo/protocol/domain/event";
import { DateTime, Effect, Schema } from "effect";

import {
  AnswerRow,
  AskRow,
  BudgetDayRow,
  ClaimRow,
  DecisionRow,
  LandingRow,
  OutboxRow,
  ProjectRow,
  ProposalRow,
  PushEventRow,
  RatchetRow,
} from "./rows.ts";

// How each kind of row is kept, shared by every adapter: the table it lives
// in, the columns a row is found by, and its body, the row's encoded JSON.
// The SQLite tables themselves are created by `migrations.ts`.

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
  landings: tableOf("landings", LandingRow, ["sha"], (row) => ({
    landed_at: DateTime.toEpochMillis(row.landedAt),
    sha: row.sha,
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
