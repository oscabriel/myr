/**
 * The front page's tables in D1, as the platform's first D1 migration
 * (`apps/platform/migrations/0001_front_page.sql`) creates them. The file
 * holds exactly this text, and the projection's test applies the file and
 * checks that it does, so the DDL has one source.
 *
 * - `front_page`: one row per open ask of every project. `claimed` counts
 *   the live claims on the ask (a race ask may hold several); `blocked_by`
 *   is the ask's blockers as a JSON array of ask ids; `opened_at` is when
 *   its `AskOpened` happened. A landed ask's row is deleted.
 * - `cursor`: the last event applied per project. Events apply in their
 *   project's order, once each, so a replayed or late row changes nothing.
 *
 * A migration is never edited once it has run anywhere: W5 514 adds its
 * tables in `0002_projects_credits.sql`.
 */
export const FrontPageDdl = `-- The front page: every open ask of every project, projected from each
-- project's outbox by packages/project/src/projection-d1 (its tables.ts
-- holds this text). The projection is the only writer.

CREATE TABLE front_page (
  project TEXT NOT NULL,
  ask TEXT NOT NULL,
  kind TEXT NOT NULL,
  reserve TEXT,
  want TEXT NOT NULL,
  territory TEXT NOT NULL,
  -- how many live claims hold the ask
  claimed INTEGER NOT NULL,
  -- the asks it waits on, as a JSON array of ask ids
  blocked_by TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  PRIMARY KEY (project, ask)
);

-- The last event applied per project.
CREATE TABLE cursor (
  project TEXT PRIMARY KEY,
  seq INTEGER NOT NULL
);
`;
