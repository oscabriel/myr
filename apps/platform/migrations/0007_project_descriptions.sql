-- Each listed project's description, as a list last read it from the
-- README on the project's main, kept by packages/project/src/projection-d1
-- (its tables.ts holds this text). A cache: a row lost costs one read. Main
-- moves only by a landing, so a row holds while its `landed_at` is the
-- project's last landing, and a list reads the README again once it is not.

CREATE TABLE project_descriptions (
  project TEXT PRIMARY KEY,
  -- the project's last landing when the README was read (ISO 8601)
  landed_at TEXT NOT NULL,
  -- the README's first paragraph as plain text, absent when it has none
  description TEXT
);
