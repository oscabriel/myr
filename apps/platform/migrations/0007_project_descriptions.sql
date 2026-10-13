-- Each listed project's description and count of landings, as a list last
-- read them from the README on the project's main and from the project's
-- record, kept by packages/project/src/projection-d1 (its tables.ts holds
-- this text). A cache: a row lost costs one read. Both move only by a
-- landing, so a row holds while its `landed_at` is the project's last
-- landing, and a list reads the project again once it is not.

CREATE TABLE project_descriptions (
  project TEXT PRIMARY KEY,
  -- the project's last landing when it was read (ISO 8601)
  landed_at TEXT NOT NULL,
  -- the README's first paragraph as plain text, absent when it has none
  description TEXT,
  -- how many landings the project's record kept
  landings INTEGER NOT NULL
);
