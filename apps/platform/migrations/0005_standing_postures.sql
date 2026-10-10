-- Each listed project's standing posture, as a list last read it from the
-- project's own record, kept by packages/project/src/projection-d1 (its
-- tables.ts holds this text). A cache: a row lost costs one read. The
-- projection deletes a project's row in the same write as any event that
-- can move its posture, and a list writes a row only while the projection
-- has applied no event of the project later than the one the read saw.

CREATE TABLE standing_postures (
  project TEXT PRIMARY KEY,
  posture TEXT NOT NULL,
  -- when the posture moves by the clock alone (ISO 8601), absent when only
  -- an event moves it
  moves_at TEXT,
  -- the project's last event the read saw
  seen INTEGER NOT NULL
);
