-- The front page: every open ask of every project, projected from each
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
