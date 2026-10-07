import { Array, Effect, Layer, Option, Order, SynchronizedRef } from "effect";

import {
  keptEvents,
  ProjectStore,
  snapshotLandings,
} from "../project-store.ts";
import type {
  Committed,
  ProjectSnapshot,
  ProjectWrites,
} from "../project-store.ts";
import type { EventRow } from "./rows.ts";
import { EventTable, ProjectTable, QueueTable, Tables } from "./tables.ts";
import type { Column, Table } from "./tables.ts";

/** A row as a table keeps it: its columns and its encoded body. */
interface Stored {
  readonly body: string;
  readonly columns: Readonly<Record<string, Column>>;
}

/** A table's rows by key, in the order each key was first written. */
type Rows = ReadonlyMap<string, Stored>;

interface State {
  /** The kept events, oldest first, each body with its `seq`. */
  readonly events: readonly Stored[];
  readonly lastSeq: number;
  /** Each table's rows, by table name. */
  readonly tables: ReadonlyMap<string, Rows>;
}

const keyOf = <A>(table: Table<A>, columns: Stored["columns"]) =>
  JSON.stringify(table.key.map((name) => columns[name]));

const rowsIn = <A>(state: State, table: Table<A>): Rows =>
  state.tables.get(table.name) ?? new Map();

const decodeAll = <A>(table: Table<A>, stored: Iterable<Stored>) =>
  Effect.forEach(stored, (row) => table.decode(row.body));

const all = <A>(state: State, table: Table<A>) =>
  decodeAll(table, rowsIn(state, table).values());

/** A landing with the place it was first written in. */
type Placed = readonly [index: number, row: Stored];

/** Newest first: by landing time, then the later write, as `/sqlite` orders them. */
const newestFirst = Order.combine(
  Order.mapInput(Order.flip(Order.Number), ([, row]: Placed) =>
    Number(row.columns.landed_at)
  ),
  Order.mapInput(Order.flip(Order.Number), ([index]: Placed) => index)
);

const snapshotOf = (state: State) =>
  Effect.gen(function* () {
    const placed = Array.map(
      [...rowsIn(state, Tables.landings).values()],
      (row, index): Placed => [index, row]
    );

    const newest = Array.take(
      Array.sort(placed, newestFirst),
      snapshotLandings
    );

    return {
      answers: yield* all(state, Tables.answers),
      asks: yield* all(state, Tables.asks),
      budgetDays: yield* all(state, Tables.budgetDays),
      claims: yield* all(state, Tables.claims),
      decisions: yield* all(state, Tables.decisions),
      landings: yield* decodeAll(
        Tables.landings,
        Array.map(newest, ([, row]) => row)
      ),
      lastSeq: state.lastSeq,
      outbox: yield* all(state, Tables.outbox),
      project: Array.head(yield* all(state, ProjectTable)),
      proposals: yield* all(state, Tables.proposals),
      queue: Option.getOrNull(Array.head(yield* all(state, QueueTable))),
      ratchets: yield* all(state, Tables.ratchets),
    } satisfies ProjectSnapshot;
  });

/** The push events in `writes` that `state` already holds, each once. */
const seenIn = (state: State, writes: ProjectWrites) => {
  const seen = rowsIn(state, Tables.pushEvents);

  return Array.dedupe(
    Array.flatMap(writes.pushEvents ?? [], (event) =>
      seen.has(keyOf(Tables.pushEvents, { event_id: event.eventId }))
        ? [event.eventId]
        : []
    )
  );
};

/**
 * The state after `writes`, built from copies in the order `/sqlite` writes
 * its tables. A row that won't encode dies before anything is swapped in.
 */
const written = (state: State, writes: ProjectWrites) =>
  Effect.gen(function* () {
    const tables = new Map(state.tables);

    const upsert = <A>(table: Table<A>, rows: readonly A[] | undefined) =>
      Effect.gen(function* () {
        const kept = new Map(rowsIn(state, table));

        for (const row of rows ?? []) {
          const columns = table.columns(row);

          kept.set(keyOf(table, columns), {
            body: yield* table.encode(row),
            columns,
          });
        }

        tables.set(table.name, kept);
      });

    yield* upsert(
      ProjectTable,
      Option.toArray(Option.fromUndefinedOr(writes.project))
    );
    yield* upsert(Tables.asks, writes.asks);
    yield* upsert(Tables.claims, writes.claims);
    yield* upsert(Tables.answers, writes.answers);
    yield* upsert(QueueTable, writes.queue === undefined ? [] : [writes.queue]);
    yield* upsert(Tables.landings, writes.landings);
    yield* upsert(Tables.proposals, writes.proposals);
    yield* upsert(Tables.decisions, writes.decisions);
    yield* upsert(Tables.budgetDays, writes.budgetDays);
    yield* upsert(Tables.ratchets, writes.ratchets);
    yield* upsert(Tables.pushEvents, writes.pushEvents);

    const events = yield* Effect.forEach(writes.events ?? [], (event, index) =>
      Effect.map(
        EventTable.encode({ ...event, seq: state.lastSeq + index + 1 }),
        (body): Stored => ({ body, columns: {} })
      )
    );

    yield* upsert(Tables.outbox, writes.outbox);

    const committed: Committed = {
      duplicatePushEvents: [],
      seqs: Array.map(events, (_, index) => state.lastSeq + index + 1),
    };

    const next: State = {
      events: [...state.events, ...events].slice(-keptEvents),
      lastSeq: state.lastSeq + events.length,
      tables,
    };

    return [committed, next] as const;
  });

/**
 * A project's store in memory: the same tables, keys and encoded bodies as
 * `/sqlite`, held in one `SynchronizedRef` the layer makes. A commit builds
 * the next state from copies and swaps it in only when every row encoded, so
 * a failed commit leaves the previous state whole.
 */
export const ProjectStoreMemory = Layer.effect(
  ProjectStore,
  Effect.gen(function* () {
    const ref = yield* SynchronizedRef.make<State>({
      events: [],
      lastSeq: 0,
      tables: new Map(),
    });

    return ProjectStore.of({
      ackOutbox: (ids) =>
        SynchronizedRef.update(ref, (state) => {
          const kept = new Map(rowsIn(state, Tables.outbox));

          for (const id of ids) {
            kept.delete(keyOf(Tables.outbox, { id }));
          }

          return {
            ...state,
            tables: new Map(state.tables).set(Tables.outbox.name, kept),
          };
        }),
      commit: (writes) =>
        SynchronizedRef.modifyEffect(ref, (state) => {
          const duplicatePushEvents = seenIn(state, writes);

          if (duplicatePushEvents.length > 0) {
            const replay: Committed = { duplicatePushEvents, seqs: [] };

            return Effect.succeed([replay, state] as const);
          }

          return written(state, writes);
        }),
      eventsSince: (seq, limit) =>
        Effect.gen(function* () {
          const state = yield* SynchronizedRef.get(ref);
          const events = yield* decodeAll(EventTable, state.events);

          return Array.take(
            Array.flatMap(events, (event): readonly EventRow[] =>
              event.seq > seq ? [{ event, seq: event.seq }] : []
            ),
            limit
          );
        }),
      landing: (sha) =>
        Effect.gen(function* () {
          const state = yield* SynchronizedRef.get(ref);

          const row = rowsIn(state, Tables.landings).get(
            keyOf(Tables.landings, { sha })
          );

          return row === undefined
            ? Option.none()
            : Option.some(yield* Tables.landings.decode(row.body));
        }),
      load: () => Effect.flatMap(SynchronizedRef.get(ref), snapshotOf),
    });
  })
);
