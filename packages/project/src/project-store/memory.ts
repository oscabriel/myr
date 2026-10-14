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
import type { EventRow, LedgerRow } from "./rows.ts";
import {
  EventTable,
  LayerReadTable,
  ProjectTable,
  QueueTable,
  Tables,
  writeAll,
} from "./tables.ts";
import type { Column, Table, Upsert } from "./tables.ts";

interface Stored {
  readonly body: string;
  readonly columns: Readonly<Record<string, Column>>;
}

type Rows = ReadonlyMap<string, Stored>;

interface State {
  readonly lastRead: number;
  readonly lastSeq: number;
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

type Placed = readonly [index: number, row: Stored];

const newestFirst = Order.combine(
  Order.mapInput(Order.flip(Order.Number), ([, row]: Placed) =>
    Number(row.columns.landed_at)
  ),
  Order.mapInput(Order.flip(Order.Number), ([index]: Placed) => index)
);

const bySeq = Order.mapInput(Order.Number, (entry: LedgerRow) => entry.seq);

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
      attempts: yield* all(state, Tables.attempts),
      budgetDays: yield* all(state, Tables.budgetDays),
      claims: yield* all(state, Tables.claims),
      decisions: yield* all(state, Tables.decisions),
      discussions: yield* all(state, Tables.discussions),
      envValues: yield* all(state, Tables.envValues),
      landings: yield* decodeAll(
        Tables.landings,
        Array.map(newest, ([, row]) => row)
      ),
      lastSeq: state.lastSeq,
      layers: yield* all(state, Tables.layers),
      ledger: Array.sort(yield* all(state, Tables.ledger), bySeq),
      outbox: yield* all(state, Tables.outbox),
      project: Array.head(yield* all(state, ProjectTable)),
      proposals: yield* all(state, Tables.proposals),
      queue: Option.getOrNull(Array.head(yield* all(state, QueueTable))),
      ratchets: yield* all(state, Tables.ratchets),
    } satisfies ProjectSnapshot;
  });

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

/** Writes rows into copies of `tables`' maps, never into the maps themselves. */
const upsertInto =
  (tables: Map<string, Rows>): Upsert<never, never> =>
  (table, rows) =>
    Effect.gen(function* () {
      const kept = new Map(tables.get(table.name));

      for (const row of rows) {
        const columns = table.columns(row);

        kept.set(keyOf(table, columns), {
          body: yield* table.encode(row),
          columns,
        });
      }

      tables.set(table.name, kept);
    });

const written = (state: State, writes: ProjectWrites) =>
  Effect.gen(function* () {
    const tables = new Map(state.tables);

    const seqs = yield* writeAll(
      writes,
      { read: state.lastRead, seq: state.lastSeq },
      upsertInto(tables)
    );

    const events = [...(tables.get(EventTable.name) ?? [])];

    tables.set(EventTable.name, new Map(events.slice(-keptEvents)));

    const committed: Committed = { duplicatePushEvents: [], seqs };

    const next: State = {
      lastRead: state.lastRead + (writes.layerReads?.length ?? 0),
      lastSeq: state.lastSeq + seqs.length,
      tables,
    };

    return [committed, next] as const;
  });

export const ProjectStoreMemory = Layer.effect(
  ProjectStore,
  Effect.gen(function* () {
    const ref = yield* SynchronizedRef.make<State>({
      lastRead: 0,
      lastSeq: 0,
      tables: new Map(),
    });

    return ProjectStore.of({
      ackOutbox: (ids) =>
        SynchronizedRef.modify(ref, (state) => {
          const kept = new Map(rowsIn(state, Tables.outbox));
          const taken: string[] = [];

          for (const id of ids) {
            if (kept.delete(keyOf(Tables.outbox, { id }))) {
              taken.push(id);
            }
          }

          return [
            taken,
            {
              ...state,
              tables: new Map(state.tables).set(Tables.outbox.name, kept),
            },
          ] as const;
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
          const events = yield* all(
            yield* SynchronizedRef.get(ref),
            EventTable
          );

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
      landingCount: () =>
        Effect.map(
          SynchronizedRef.get(ref),
          (state) => rowsIn(state, Tables.landings).size
        ),
      layerReadsSince: (seq, limit) =>
        Effect.gen(function* () {
          const reads = yield* all(
            yield* SynchronizedRef.get(ref),
            LayerReadTable
          );

          return Array.take(
            reads.filter((read) => read.seq > seq),
            limit
          );
        }),
      load: () => Effect.flatMap(SynchronizedRef.get(ref), snapshotOf),
    });
  })
);
