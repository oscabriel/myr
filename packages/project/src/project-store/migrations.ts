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

// A maintainer's day has no budget: Today shows every open decision.
const dropBudgetDays = Effect.gen(function* () {
  const sql = yield* SqlClient;

  yield* sql`DROP TABLE budget_days`;
});

const discussions = Effect.gen(function* () {
  const sql = yield* SqlClient;

  yield* sql`CREATE TABLE discussions (id TEXT PRIMARY KEY, body TEXT NOT NULL)`;
});

// A project takes no proposals: a discussion becomes an ask. What a proposal
// left behind goes, so every row that stays decodes; a thread a proposal
// came from reads as closed.
const dropProposals = Effect.gen(function* () {
  const sql = yield* SqlClient;

  yield* sql`DROP TABLE proposals`;
  yield* sql`DELETE FROM decisions
    WHERE json_extract(body, '$.subject._tag') = 'OpenProposal'`;
  yield* sql`DELETE FROM outbox
    WHERE json_extract(body, '$.kind') = 'StartDraft'
      OR EXISTS (
        SELECT 1 FROM json_each(outbox.body, '$.body.points')
        WHERE json_extract(json_each.value, '$._tag') = 'Drafted'
      )`;
  // A proposal's event keeps its seq, as a decision declined that no reader
  // acts on beyond reading the project again: the front page's projection
  // takes a project's events in an unbroken run of seqs, and the next seq is
  // the highest kept one's, so a deleted newest event would hand its seq to
  // the next event, which a reader already past it would never see.
  yield* sql`UPDATE events
    SET body = json_object(
      '_tag', 'Decided',
      'at', json_extract(body, '$.at'),
      'seq', json_extract(body, '$.seq'),
      'choice', 'decline',
      'decision', 'dec-000000'
    )
    WHERE json_extract(body, '$._tag') IN ('ProposalOpened', 'ProposalDrafted')`;
  yield* sql`UPDATE outbox
    SET body = json_set(body, '$.body.event', json_object(
      '_tag', 'Decided',
      'at', json_extract(body, '$.body.event.at'),
      'seq', json_extract(body, '$.body.event.seq'),
      'choice', 'decline',
      'decision', 'dec-000000'
    ))
    WHERE json_extract(body, '$.body.event._tag') IN ('ProposalOpened', 'ProposalDrafted')`;
  yield* sql`UPDATE discussions
    SET body = json_set(json_remove(body, '$.proposal'), '$.state', 'closed')
    WHERE json_extract(body, '$.state') = 'proposed'`;
});

export const migrations = {
  "1_project_state": projectState,
  "2_visibility": visibility,
  "3_drop_budget_days": dropBudgetDays,
  "4_discussions": discussions,
  "5_drop_proposals": dropProposals,
};

export const migrate: Effect.Effect<
  readonly (readonly [id: number, name: string])[],
  never,
  SqlClient
> = Migrator.make({})({
  loader: Migrator.fromRecord(migrations),
  table: "migrations",
}).pipe(Effect.orDie);
