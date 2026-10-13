import type { Handle } from "@repo/protocol/ids";

/** The projection writes and the credits query reads by this key, as `sameHandle` compares. */
export const handleKey = (handle: Handle): string => handle.toLowerCase();

/** Must equal `apps/platform/migrations/0001_front_page.sql`; the projection's test checks it. */
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

/** Must equal `apps/platform/migrations/0004_projects_credits.sql`; the credits test checks it. */
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

/** Must equal `apps/platform/migrations/0005_standing_postures.sql`; the postures' test checks it. */
export const StandingPosturesDdl = `-- Each listed project's standing posture, as a list last read it from the
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
`;

/** Must equal `apps/platform/migrations/0007_project_descriptions.sql`; the descriptions' test checks it. */
export const ProjectDescriptionsDdl = `-- Each listed project's description and count of landings, as a list last
-- read them from the README on the project's main and from the project's
-- record, kept by packages/project/src/projection-d1 (its tables.ts holds
-- this text). A cache: a row lost costs one read. Both move only by a
-- landing, so a row holds while its \`landed_at\` is the project's last
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
`;
