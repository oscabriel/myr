import { Effect } from "effect";
import * as Migrator from "effect/sql/Migrator";
import { SqlClient } from "effect/sql/SqlClient";

// A migration is never edited once it has run anywhere: a change is a new numbered entry.

const projectState = Effect.gen(function* () {
  const sql = yield* SqlClient;

  yield* sql`CREATE TABLE project (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    body TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE asks (id TEXT PRIMARY KEY, body TEXT NOT NULL)`;
  yield* sql`CREATE TABLE claims (
    ask TEXT NOT NULL,
    claimant TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (ask, claimant)
  )`;
  yield* sql`CREATE TABLE answers (
    request_id TEXT PRIMARY KEY,
    body TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE landing_queue (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    body TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE landings (
    sha TEXT PRIMARY KEY,
    landed_at INTEGER NOT NULL,
    body TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX landings_newest ON landings (landed_at)`;
  yield* sql`CREATE TABLE proposals (id TEXT PRIMARY KEY, body TEXT NOT NULL)`;
  yield* sql`CREATE TABLE decisions (id TEXT PRIMARY KEY, body TEXT NOT NULL)`;
  yield* sql`CREATE TABLE budget_days (
    decider TEXT NOT NULL,
    day TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (decider, day)
  )`;
  yield* sql`CREATE TABLE ratchets (
    ratchet TEXT NOT NULL,
    territory TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (ratchet, territory)
  )`;
  yield* sql`CREATE TABLE push_events (
    event_id TEXT PRIMARY KEY,
    body TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    body TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE outbox (id TEXT PRIMARY KEY, body TEXT NOT NULL)`;
});

const visibility = Effect.gen(function* () {
  const sql = yield* SqlClient;

  yield* sql`CREATE TABLE layers (name TEXT PRIMARY KEY, body TEXT NOT NULL)`;
  yield* sql`CREATE TABLE attempts (
    ask TEXT NOT NULL,
    claimant TEXT NOT NULL,
    area TEXT NOT NULL,
    week TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (ask, claimant, area, week)
  )`;
  yield* sql`CREATE TABLE ledger (
    seq INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    body TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE env_values (key TEXT PRIMARY KEY, body TEXT NOT NULL)`;
  yield* sql`CREATE TABLE layer_reads (
    seq INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    body TEXT NOT NULL
  )`;
});

const discussions = Effect.gen(function* () {
  const sql = yield* SqlClient;

  yield* sql`CREATE TABLE discussions (id TEXT PRIMARY KEY, body TEXT NOT NULL)`;
});

const migrations = {
  "1_project_state": projectState,
  "2_visibility": visibility,
  "3_discussions": discussions,
};

export const migrate: Effect.Effect<
  readonly (readonly [id: number, name: string])[],
  never,
  SqlClient
> = Migrator.make({})({
  loader: Migrator.fromRecord(migrations),
  table: "migrations",
}).pipe(Effect.orDie);
