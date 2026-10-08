import { Effect } from "effect";
import * as Migrator from "effect/sql/Migrator";
import { SqlClient } from "effect/sql/SqlClient";

// A project's tables. Each holds its key columns and `body`, the row's
// encoded JSON (see `tables.ts`). A migration is never edited once it has
// run anywhere: a change is a new numbered entry.

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

// The visibility tables (W6 609): a project's layers, the attempts on its
// held-back checks, its public ledger, its write-only values, and the read
// log of its layer repos. Without the visibility cartridge they stay empty.
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

/** Every migration, by `<id>_<name>`, in the order they run. */
const migrations = {
  "1_project_state": projectState,
  "2_visibility": visibility,
};

/**
 * Brings a project's database up to date and returns the migrations it ran.
 * It records each one it runs (in `migrations`), so running it again runs
 * nothing. It needs no filesystem, so it runs in a Durable Object. A
 * migration that fails is a defect: the project cannot start without its
 * tables.
 */
export const migrate: Effect.Effect<
  readonly (readonly [id: number, name: string])[],
  never,
  SqlClient
> = Migrator.make({})({
  loader: Migrator.fromRecord(migrations),
  table: "migrations",
}).pipe(Effect.orDie);
