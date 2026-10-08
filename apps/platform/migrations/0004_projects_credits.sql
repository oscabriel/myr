-- The project list and every person's credits, projected from each
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
-- project: a count by role and area, never a score. `handle_key` is the
-- handle lowercased, the rule protocol's `sameHandle` compares by. The
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
