/**
 * The project list and a person's credits over D1, on sqlite-node with the
 * platform's D1 migrations applied from their files: projects' outbox rows
 * go in through `ProjectionD1`, and `FrontPageD1` reads every project, and
 * one person's credits by project, area and role, back out in one query
 * each.
 */
import { NodeServices } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import type { AskListing } from "@repo/protocol/domain/ask";
import type { Credit } from "@repo/protocol/domain/credit";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import {
  AskId,
  DecisionId,
  Handle,
  KindName,
  LandedSha,
  ProjectName,
} from "@repo/protocol/ids";
import { DateTime, Effect, FileSystem, Layer, Path } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { FrontPage } from "../src/front-page.ts";
import { projectedRows } from "../src/outbox.ts";
import type { OutboxRow } from "../src/project-store/rows.ts";
import { FrontPageD1 } from "../src/projection-d1/front-page.ts";
import { ProjectionD1 } from "../src/projection-d1/projection.ts";
import { ProjectsCreditsDdl } from "../src/projection-d1/tables.ts";
import { Projection } from "../src/projection.ts";

/** A migration of the platform's D1 database, as its file holds it. */
const migration = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return yield* fs.readFileString(
      yield* path.fromFileUrl(
        new URL(`../../../apps/platform/migrations/${file}`, import.meta.url)
      )
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

/** Runs a migration's statements in order, as `wrangler d1 migrations apply` does. */
const applied = (file: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    for (const statement of (yield* migration(file)).split(";")) {
      if (statement.trim().length > 0) {
        yield* sql.unsafe(statement);
      }
    }
  }).pipe(Effect.orDie);

const frontPageMigration = "0001_front_page.sql";

const projectsMigration = "0004_projects_credits.sql";

/** A fresh in-memory database each time, with the projection's migrations applied. */
const database = Layer.effectDiscard(
  Effect.andThen(applied(frontPageMigration), applied(projectsMigration))
).pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
  Layer.orDie
);

const world = Layer.mergeAll(ProjectionD1, FrontPageD1).pipe(
  Layer.provideMerge(database)
);

/** A database the front page's migration alone made, as W3 and W4 left it. */
const beforeProjects = Layer.mergeAll(ProjectionD1, FrontPageD1).pipe(
  Layer.provideMerge(
    Layer.effectDiscard(applied(frontPageMigration)).pipe(
      Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
      Layer.orDie
    )
  )
);

const datekit = ProjectName.make("datekit");

const burrow = ProjectName.make("burrow");

const fix = KindName.make("fix");

const parseIso = AskId.make("parse-iso");

const weekStart = AskId.make("week-start");

const formatTz = AskId.make("format-tz");

const noAny = AskId.make("no-any");

const bram = Handle.make("bram");

const ines = Handle.make("ines-v");

const okonkwo = Handle.make("okonkwo");

const landing = LandedSha.make("a".repeat(40));

const at = (minute: number) =>
  DateTime.makeUnsafe(`2026-10-08T09:${String(minute).padStart(2, "0")}:00Z`);

const listing = (ask: AskId, territory: string): AskListing => ({
  ask,
  blockedBy: [],
  claimed: false,
  kind: fix,
  territory,
  want: `${ask} works`,
});

/** One project's events, numbered from `first`, as outbox rows. */
const rows = (
  project: ProjectName,
  first: number,
  events: readonly ((seq: number) => ProjectEvent)[]
) =>
  projectedRows(
    project,
    events.map((event, index) => event(first + index)),
    at(59)
  );

const opened =
  (ask: AskListing, minute: number) =>
  (seq: number): ProjectEvent =>
    ProjectEvent.cases.AskOpened.make({ ask, at: at(minute), seq });

const closedBy =
  (ask: AskId) =>
  (seq: number): ProjectEvent =>
    ProjectEvent.cases.AskClosed.make({ ask, at: at(40), landing, seq });

/** bram's answer to `ask` lands at `minute`, crediting `credits`, written with an agent. */
const landed =
  (ask: AskId, minute: number, credits: readonly Credit[]) =>
  (seq: number): ProjectEvent =>
    ProjectEvent.cases.Landed.make({
      at: at(minute),
      landing: {
        ask,
        assisted: [{ harness: "claude-code", model: "opus", verified: true }],
        author: bram,
        credits,
        landedAt: at(minute),
        parent: LandedSha.make("b".repeat(40)),
        project: datekit,
        sha: landing,
      },
      seq,
    });

/** The trailers on bram's landing of `parse-iso`. */
const parseIsoCredits: readonly Credit[] = [
  { handle: ines, role: "Asked-by" },
  { handle: bram, role: "Signed-off-by" },
  { handle: okonkwo, role: "Mentored-by" },
];

const apply = (batch: Effect.Effect<readonly OutboxRow[]>) =>
  Effect.flatMap(batch, (each) =>
    Projection.use((projection) => projection.apply(each))
  );

/** burrow with one ask opened. */
const burrowRows = rows(burrow, 1, [opened(listing(noAny, "core"), 4)]);

/** datekit with three asks opened and one landed; burrow with one opened. */
const both = Effect.zipWith(
  rows(datekit, 1, [
    opened(listing(parseIso, "src"), 1),
    opened(listing(weekStart, "src"), 2),
    opened(listing(formatTz, "src"), 3),
    landed(parseIso, 40, parseIsoCredits),
    closedBy(parseIso),
  ]),
  burrowRows,
  (one, other) => [...one, ...other]
);

/** Every row of the projection's tables, to compare a replay against. */
const tables = Effect.gen(function* () {
  const sql = yield* SqlClient;

  return {
    credits:
      yield* sql`SELECT * FROM credits ORDER BY handle_key, project, area, role`,
    cursor: yield* sql`SELECT * FROM cursor ORDER BY project`,
    frontPage: yield* sql`SELECT * FROM front_page ORDER BY project, ask`,
    projects: yield* sql`SELECT * FROM projects ORDER BY project`,
  };
});

describe("the project list and credits in D1", () => {
  it.effect(
    "lists every project with its open asks, posture and last landing",
    () =>
      Effect.gen(function* () {
        yield* apply(both);

        const front = yield* FrontPage;

        expect(yield* front.projects()).toStrictEqual([
          { openAsks: 1, posture: "open", project: burrow },
          {
            landedAt: at(40),
            openAsks: 2,
            posture: "open",
            project: datekit,
          },
        ]);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "credits each person on a landing once in their role, in the landed ask's area",
    () =>
      Effect.gen(function* () {
        yield* apply(both);

        const front = yield* FrontPage;

        expect({
          bram: yield* front.credits(bram),
          ines: yield* front.credits(ines),
          okonkwo: yield* front.credits(okonkwo),
        }).toStrictEqual({
          bram: [
            { area: "src", count: 1, project: datekit, role: "Signed-off-by" },
          ],
          ines: [{ area: "src", count: 1, project: datekit, role: "Asked-by" }],
          okonkwo: [
            { area: "src", count: 1, project: datekit, role: "Mentored-by" },
          ],
        });
      }).pipe(Effect.provide(world))
  );

  it.effect("never credits the agent an answer was written with", () =>
    Effect.gen(function* () {
      yield* apply(both);

      const front = yield* FrontPage;

      expect(yield* front.credits(Handle.make("claude-code"))).toStrictEqual(
        []
      );
      expect(
        (yield* front.credits(bram)).map(({ role }) => role)
      ).toStrictEqual(["Signed-off-by"]);
    }).pipe(Effect.provide(world))
  );

  it.effect("changes nothing when the same rows come again", () =>
    Effect.gen(function* () {
      yield* apply(both);

      const before = yield* tables;

      yield* apply(both);
      yield* apply(both);

      expect(yield* tables).toStrictEqual(before);
    }).pipe(Effect.provide(world))
  );

  it.effect("reads no credits for a person with no landings", () =>
    Effect.gen(function* () {
      yield* apply(both);

      expect(
        yield* FrontPage.use((front) => front.credits(Handle.make("dora")))
      ).toStrictEqual([]);
    }).pipe(Effect.provide(world))
  );

  it.effect("reads the migration the platform's D1 applies", () =>
    Effect.gen(function* () {
      expect(yield* migration(projectsMigration)).toBe(ProjectsCreditsDdl);
    })
  );

  it.effect(
    "keeps every project the front page knew of across the migration, with its open asks",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient;

        // The rows 309's projection wrote before the project list existed.
        yield* sql`INSERT INTO cursor (project, seq) VALUES ('datekit', 4), ('burrow', 2)`;
        yield* sql`INSERT INTO front_page
            (project, ask, kind, reserve, want, territory, claimed, blocked_by, opened_at)
          VALUES
            ('datekit', 'week-start', 'fix', NULL, 'week-start works', 'src', 0, '[]', '2026-10-08T09:02:00.000Z'),
            ('datekit', 'format-tz', 'fix', NULL, 'format-tz works', 'src', 0, '[]', '2026-10-08T09:03:00.000Z')`;

        yield* applied(projectsMigration);

        const front = yield* FrontPage;

        expect(yield* front.projects()).toStrictEqual([
          { openAsks: 0, posture: "open", project: burrow },
          { openAsks: 2, posture: "open", project: datekit },
        ]);

        yield* apply(rows(burrow, 3, [opened(listing(noAny, "core"), 5)]));

        expect(yield* front.projects()).toStrictEqual([
          { openAsks: 1, posture: "open", project: burrow },
          { openAsks: 2, posture: "open", project: datekit },
        ]);
      }).pipe(Effect.provide(beforeProjects))
  );

  it.effect(
    "counts each landing once per person and role, by area, whatever case a trailer spells the handle in",
    () =>
      Effect.gen(function* () {
        yield* apply(
          rows(datekit, 1, [
            opened(listing(parseIso, "src"), 1),
            opened(listing(weekStart, "src"), 2),
            opened(listing(formatTz, "format"), 3),
            landed(parseIso, 40, [
              { handle: bram, role: "Signed-off-by" },
              { handle: Handle.make("Bram"), role: "Signed-off-by" },
              { handle: bram, role: "Finished-by" },
            ]),
            closedBy(parseIso),
            landed(weekStart, 41, [{ handle: bram, role: "Signed-off-by" }]),
            closedBy(weekStart),
            landed(formatTz, 42, [
              { handle: Handle.make("BRAM"), role: "Signed-off-by" },
            ]),
            closedBy(formatTz),
          ])
        );

        const front = yield* FrontPage;

        const counted = [
          { area: "format", count: 1, project: datekit, role: "Signed-off-by" },
          { area: "src", count: 1, project: datekit, role: "Finished-by" },
          { area: "src", count: 2, project: datekit, role: "Signed-off-by" },
        ];

        expect(yield* front.credits(bram)).toStrictEqual(counted);
        expect(yield* front.credits(Handle.make("Bram"))).toStrictEqual(
          counted
        );
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "credits no area for a landing of no ask, or of an ask the front page never held, yet notes when it landed",
    () =>
      Effect.gen(function* () {
        yield* apply(
          rows(datekit, 1, [
            (seq) =>
              ProjectEvent.cases.Landed.make({
                at: at(20),
                landing: {
                  assisted: [],
                  author: ines,
                  credits: [{ handle: ines, role: "Released-by" }],
                  landedAt: at(20),
                  project: datekit,
                  sha: landing,
                },
                seq,
              }),
            landed(parseIso, 21, parseIsoCredits),
          ])
        );

        const front = yield* FrontPage;

        expect(yield* front.projects()).toStrictEqual([
          { landedAt: at(21), openAsks: 0, posture: "open", project: datekit },
        ]);
        expect(yield* front.credits(ines)).toStrictEqual([]);
        expect(yield* front.credits(bram)).toStrictEqual([]);
      }).pipe(Effect.provide(world))
  );

  it.effect(
    "moves a project's posture when its ledger records a posture change, on its list row and its asks",
    () =>
      Effect.gen(function* () {
        yield* apply(
          rows(datekit, 1, [
            opened(listing(parseIso, "src"), 1),
            (seq) =>
              ProjectEvent.cases.LedgerAppended.make({
                at: at(10),
                entry: LedgerEntry.cases.PostureChanged.make({
                  at: at(10),
                  decision: DecisionId.make("decision-posture1"),
                  from: "open",
                  seq: 1,
                  to: "openWithSealedEvidence",
                }),
                seq,
              }),
          ])
        );
        yield* apply(burrowRows);

        const front = yield* FrontPage;

        expect(yield* front.projects()).toStrictEqual([
          { openAsks: 1, posture: "open", project: burrow },
          {
            openAsks: 1,
            posture: "openWithSealedEvidence",
            project: datekit,
          },
        ]);
        expect(
          (yield* front.entries({})).map(({ posture, project }) => ({
            posture,
            project,
          }))
        ).toStrictEqual([
          { posture: "open", project: burrow },
          { posture: "openWithSealedEvidence", project: datekit },
        ]);
      }).pipe(Effect.provide(world))
  );
});
