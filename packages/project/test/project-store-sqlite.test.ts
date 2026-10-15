import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { DecisionId } from "@repo/protocol/ids";
import { DateTime, Effect, Layer, Record, Schema } from "effect";
import * as Migrator from "effect/sql/Migrator";
import { SqlClient } from "effect/sql/SqlClient";

import { ProjectEventInput } from "../src/events.ts";
import { OutboxBody } from "../src/outbox.ts";
import { ProjectStore } from "../src/project-store.ts";
import { migrate, migrations } from "../src/project-store/migrations.ts";
import { ProjectStoreSqlite } from "../src/project-store/sqlite.ts";
import { describeProjectStore } from "./project-store.contract.ts";

const database = SqliteClient.layer({ filename: ":memory:" }).pipe(Layer.orDie);

describeProjectStore(
  "sqlite",
  ProjectStoreSqlite.pipe(Layer.provide(database))
);

// Rows as a store kept them while it still took proposals, as the JSON
// text it wrote: no schema in the code makes them any more.
const at = "2026-10-07T12:00:00.000Z";

const outbox = (id: string, kind: string, body: string) =>
  `{"attempts":0,"body":${body},"id":"${id}","kind":"${kind}","notBefore":"${at}"}`;

const opened = (seq: number) =>
  `{"_tag":"ProposalOpened","at":"${at}","proposal":"prop-000001","seq":${seq}}`;

const kept: readonly (readonly [string, string, string])[] = [
  ["proposals", "prop-000001", '{"id":"prop-000001"}'],
  [
    "discussions",
    "disc-000001",
    `{"id":"disc-000001","openedAt":"${at}","opener":"dave","posts":[{"at":"${at}","body":"Could parse take ISO weeks?","by":"dave"}],"project":"alice/datekit","proposal":"prop-000001","state":"proposed","title":"ISO week dates"}`,
  ],
  ["decisions", "dec-000001", '{"subject":{"_tag":"OpenProposal"}}'],
  [
    "outbox",
    "draft:prop-000001:r1",
    outbox("draft:prop-000001:r1", "StartDraft", '{"_tag":"StartDraft"}'),
  ],
  [
    "outbox",
    "drafted:prop-000001:r1",
    outbox(
      "drafted:prop-000001:r1",
      "Measured",
      '{"_tag":"Measured","points":[{"_tag":"Drafted"}]}'
    ),
  ],
  [
    "outbox",
    "projected:2",
    outbox(
      "projected:2",
      "Projected",
      `{"_tag":"Projected","event":${opened(2)},"project":"alice/datekit"}`
    ),
  ],
];

const beforeProposalsLeft = Effect.gen(function* () {
  const sql = yield* SqlClient;

  yield* Migrator.make({})({
    loader: Migrator.fromRecord(
      Record.filter(migrations, (_, name) => name !== "5_drop_proposals")
    ),
    table: "migrations",
  });

  yield* Effect.forEach(
    kept,
    ([table, id, body]) =>
      sql`INSERT INTO ${sql(table)} (id, body) VALUES (${id}, ${body})`,
    { discard: true }
  );

  yield* sql`INSERT INTO events (seq, body) VALUES (1, ${opened(1)})`;
});

const decodeOutbox = Schema.decodeUnknownSync(Schema.toCodecJson(OutboxBody));

const named = (body: OutboxBody) =>
  OutboxBody.guards.Projected(body)
    ? `${body.event._tag} ${body.event.seq}`
    : body._tag;

describe("the project store's migrations", () => {
  it.effect("run each migration once on a fresh database", () =>
    Effect.gen(function* () {
      expect(yield* migrate).toStrictEqual([
        [1, "project_state"],
        [2, "visibility"],
        [3, "drop_budget_days"],
        [4, "discussions"],
        [5, "drop_proposals"],
      ]);
      expect(yield* migrate).toStrictEqual([]);
    }).pipe(Effect.provide(database))
  );

  it.effect("run again over a store's rows, change nothing", () =>
    Effect.gen(function* () {
      const store = yield* ProjectStore;

      yield* store.commit({ queue: { order: [] } });

      expect(yield* migrate).toStrictEqual([]);
      expect((yield* store.load()).queue).toStrictEqual({ order: [] });
    }).pipe(Effect.provide(Layer.provideMerge(ProjectStoreSqlite, database)))
  );

  it.effect(
    "drop what proposals left, so every row a store kept still decodes",
    () =>
      Effect.gen(function* () {
        yield* beforeProposalsLeft;

        expect(yield* migrate).toStrictEqual([[5, "drop_proposals"]]);

        const { events, loaded, next } = yield* ProjectStore.use((store) =>
          Effect.all({
            events: store.eventsSince(0, 10),
            loaded: store.load(),
            next: store.commit({
              events: [
                ProjectEventInput.Decided({
                  at: DateTime.makeUnsafe("2026-10-07T00:00:00Z"),
                  choice: "accept",
                  decision: DecisionId.make("dec-000002"),
                }),
              ],
            }),
          })
        ).pipe(Effect.provide(ProjectStoreSqlite));

        expect(
          loaded.discussions.map(({ id, state }) => ({ id, state }))
        ).toStrictEqual([{ id: "disc-000001", state: "closed" }]);
        expect(loaded.decisions).toStrictEqual([]);
        // A projected event not yet delivered keeps its seq, as a no-op.
        expect(
          loaded.outbox.map(({ body }) => named(decodeOutbox(body)))
        ).toStrictEqual(["Decided 2"]);
        // The newest kept event keeps its seq, so the next one takes a fresh seq.
        expect({
          kept: events.map(({ event }) => `${event._tag} ${event.seq}`),
          next: next.seqs,
        }).toStrictEqual({ kept: ["Decided 1"], next: [2] });
      }).pipe(
        Effect.provide(
          SqliteClient.layer({ filename: ":memory:" }).pipe(Layer.orDie)
        )
      )
  );
});
