-- The latest landings across every project, and the answers the gate
-- refused, projected from each project's outbox by
-- packages/project/src/projection-d1 (its tables.ts holds this text). The
-- projection is the only writer, and keeps only the rows the list shows.
-- Every column is a public fact: a refusal keeps its tag and area alone.

CREATE TABLE recent_landings (
  project TEXT NOT NULL,
  -- the event's number in its project
  seq INTEGER NOT NULL,
  -- when it landed or was refused (ISO 8601)
  at TEXT NOT NULL,
  -- 'landed' or 'refused'
  outcome TEXT NOT NULL,
  -- the ask the answer answered, absent for a landing that answered none
  ask TEXT,
  -- the ask a landing opened
  opened TEXT,
  -- the landed commit, absent for a refusal
  sha TEXT,
  -- the want of the ask it answered or opened, when the list knew it
  want TEXT,
  -- a refusal's tags and areas as a JSON array, absent for a landing
  refusals TEXT,
  PRIMARY KEY (project, seq)
);

CREATE INDEX recent_landings_latest ON recent_landings (at DESC, project, seq DESC);
