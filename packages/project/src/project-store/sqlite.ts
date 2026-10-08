import { Array, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { Statement } from "effect/sql/Statement";

import {
  keptEvents,
  ProjectStore,
  snapshotLandings,
} from "../project-store.ts";
import type { ProjectWrites } from "../project-store.ts";
import { migrate } from "./migrations.ts";
import {
  EventTable,
  LayerReadTable,
  ProjectTable,
  QueueTable,
  Tables,
  writeAll,
} from "./tables.ts";
import type { Table } from "./tables.ts";

// What SQLite hands back is decoded like any other outside input.
const Bodies = Schema.Array(Schema.Struct({ body: Schema.String }));

const decodeBodies = Schema.decodeUnknownEffect(Bodies);

const EventIds = Schema.Array(Schema.Struct({ event_id: Schema.String }));

const decodeEventIds = Schema.decodeUnknownEffect(EventIds);

const LastSeq = Schema.Tuple([Schema.Struct({ last: Schema.Int })]);

const decodeLastSeq = Schema.decodeUnknownEffect(LastSeq);

/** The rows a query returns, each decoded from its body. */
const bodiesOf = <A>(table: Table<A>, statement: Statement<object>) =>
  statement.pipe(
    Effect.flatMap(decodeBodies),
    Effect.flatMap((rows) =>
      Effect.forEach(rows, (row) => table.decode(row.body))
    )
  );

/**
 * A project's store on SQLite through `effect/sql`, so the same code runs on
 * a Durable Object's SQLite (`@effect/sql-sqlite-do`, given the storage so
 * transactions work) and on sqlite-node in tests. The layer runs the
 * migrations first. `load` and `commit` each run in one transaction; a
 * `SqlError` is a defect (see `ProjectStore`).
 */
export const ProjectStoreSqlite = Layer.effect(
  ProjectStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    yield* migrate;

    const all = <A>(table: Table<A>) =>
      bodiesOf(table, sql`SELECT body FROM ${sql(table.name)} ORDER BY rowid`);

    const lastSeq = sql`SELECT COALESCE(MAX(seq), 0) AS last FROM events`.pipe(
      Effect.flatMap(decodeLastSeq),
      Effect.map(([row]) => row.last)
    );

    const lastRead =
      sql`SELECT COALESCE(MAX(seq), 0) AS last FROM layer_reads`.pipe(
        Effect.flatMap(decodeLastSeq),
        Effect.map(([row]) => row.last)
      );

    // One statement per row, so a key written twice in one commit replaces
    // its first row in place, as it does in `/memory`.
    const upsert = <A>(table: Table<A>, rows: readonly A[]) =>
      Effect.forEach(
        rows,
        (row) =>
          Effect.gen(function* () {
            const columns = {
              ...table.columns(row),
              body: yield* table.encode(row),
            };

            const updates = Object.keys(columns)
              .filter((column) => !table.key.includes(column))
              .map((column) => `${column} = excluded.${column}`);

            yield* sql`INSERT INTO ${sql(table.name)} ${sql.insert(columns)}
              ON CONFLICT (${sql.literal(table.key.join(", "))})
              DO UPDATE SET ${sql.literal(updates.join(", "))}`;
          }),
        { discard: true }
      );

    const seenPushEvents = (writes: ProjectWrites) => {
      const ids = Array.map(writes.pushEvents ?? [], (event) => event.eventId);

      return Array.isReadonlyArrayNonEmpty(ids)
        ? sql`SELECT event_id FROM push_events WHERE ${sql.in("event_id", ids)}`.pipe(
            Effect.flatMap(decodeEventIds),
            Effect.map((rows) => {
              const seen = new Set(rows.map((row) => row.event_id));

              return Array.dedupe(ids.filter((id) => seen.has(id)));
            })
          )
        : Effect.succeed([]);
    };

    const write = (writes: ProjectWrites) =>
      Effect.gen(function* () {
        const last = yield* lastSeq;

        const seqs = yield* writeAll(
          writes,
          { read: yield* lastRead, seq: last },
          upsert
        );

        yield* sql`DELETE FROM events WHERE seq <= ${last + seqs.length - keptEvents}`;

        return { duplicatePushEvents: [], seqs };
      });

    return ProjectStore.of({
      ackOutbox: (ids) =>
        Array.isReadonlyArrayNonEmpty(ids)
          ? sql`DELETE FROM outbox WHERE ${sql.in("id", ids)}`.pipe(
              Effect.asVoid,
              Effect.orDie
            )
          : Effect.void,
      commit: (writes) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const duplicatePushEvents = yield* seenPushEvents(writes);

              return duplicatePushEvents.length > 0
                ? { duplicatePushEvents, seqs: [] }
                : yield* write(writes);
            })
          )
          .pipe(Effect.orDie),
      eventsSince: (seq, limit) =>
        bodiesOf(
          EventTable,
          sql`SELECT body FROM events WHERE seq > ${seq} ORDER BY seq LIMIT ${limit}`
        ).pipe(
          Effect.map(Array.map((event) => ({ event, seq: event.seq }))),
          Effect.orDie
        ),
      landing: (sha) =>
        bodiesOf(
          Tables.landings,
          sql`SELECT body FROM landings WHERE sha = ${sha}`
        ).pipe(Effect.map(Array.head), Effect.orDie),
      layerReadsSince: (seq, limit) =>
        bodiesOf(
          LayerReadTable,
          sql`SELECT body FROM layer_reads WHERE seq > ${seq} ORDER BY seq LIMIT ${limit}`
        ).pipe(Effect.orDie),
      load: () =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              return {
                answers: yield* all(Tables.answers),
                asks: yield* all(Tables.asks),
                attempts: yield* all(Tables.attempts),
                budgetDays: yield* all(Tables.budgetDays),
                claims: yield* all(Tables.claims),
                decisions: yield* all(Tables.decisions),
                envValues: yield* all(Tables.envValues),
                landings: yield* bodiesOf(
                  Tables.landings,
                  sql`SELECT body FROM landings
                    ORDER BY landed_at DESC, rowid DESC
                    LIMIT ${snapshotLandings}`
                ),
                lastSeq: yield* lastSeq,
                layers: yield* all(Tables.layers),
                ledger: yield* bodiesOf(
                  Tables.ledger,
                  sql`SELECT body FROM ledger ORDER BY seq`
                ),
                outbox: yield* all(Tables.outbox),
                project: Array.head(yield* all(ProjectTable)),
                proposals: yield* all(Tables.proposals),
                queue: Option.getOrNull(Array.head(yield* all(QueueTable))),
                ratchets: yield* all(Tables.ratchets),
              };
            })
          )
          .pipe(Effect.orDie),
    });
  })
);
