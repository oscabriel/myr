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
 * A migration is never edited once it has run anywhere: the project list adds
 * its tables in `0004_projects_credits.sql` (`ProjectsCreditsDdl`).
 */
import type { Handle } from "@repo/protocol/ids";

/**
 * The key `credits.handle_key` holds a person by: the handle lowercased,
 * the rule protocol's `sameHandle` compares by. The projection writes it and
 * the credits query reads by it, so both take it from here.
 */
export const handleKey = (handle: Handle): string => handle.toLowerCase();

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

/**
 * The project list's and the credits' tables in D1, as the platform's
 * fourth D1 migration (`apps/platform/migrations/0004_projects_credits.sql`)
 * creates them, beside the front page's. The file holds exactly this text,
 * and the projection's credits test applies the file and checks that it
 * does.
 *
 * - `projects`: one row per project the projection has heard from: its
 *   posture (`open` until a `PostureChanged` ledger entry; the fallback a
 *   list keeps when it cannot read the project's own ledger, which it reads
 *   for the posture standing now: `withStandingPosture`), its open asks
 *   (counted from `front_page` whenever an ask opens or closes), and when
 *   it last landed (null before its first landing).
 * - `credits`: how many landings credit a person (by `handle_key`, the
 *   handle lowercased: `handleKey`) in one role, in one area of one project.
 *
 * Its last statement lists the projects `cursor` already knows of, with
 * their open asks, so a database the front page's migration made keeps its
 * project list (an earlier stopgap read it from `cursor`). Their credits and
 * last landings come back only with a rebuild: clear the four tables and
 * replay each project's events from seq 1.
 */
export const ProjectsCreditsDdl = `-- The project list and every person's credits, projected from each
-- project's outbox by packages/project/src/projection-d1 beside the front
-- page (its tables.ts holds this text). The projection is the only writer.

-- One row per project the projection has heard from: its posture, how many
-- asks it has open, and when the platform last landed on its main (absent
-- before its first landing).
CREATE TABLE projects (
  project TEXT PRIMARY KEY,
  posture TEXT NOT NULL,
  open_asks INTEGER NOT NULL,
  landed_at TEXT
);

-- How many landings credit a person in one role, in one area of one
-- project: a count by role and area, never a score. \`handle_key\` is the
-- handle lowercased, the rule protocol's \`sameHandle\` compares by. The
-- primary key's index serves the lookup by person.
CREATE TABLE credits (
  handle_key TEXT NOT NULL,
  project TEXT NOT NULL,
  area TEXT NOT NULL,
  role TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (handle_key, project, area, role)
);

-- The projects 0001's tables already know of, each with its open asks, so
-- the list stays whole across this migration. On a fresh database it adds
-- nothing.
INSERT INTO projects (project, posture, open_asks, landed_at)
SELECT cursor.project, 'open',
  (SELECT COUNT(*) FROM front_page WHERE front_page.project = cursor.project),
  NULL
FROM cursor;
`;
