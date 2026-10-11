/**
 * The front page's D1 projection over sqlite-node, with the platform's D1
 * migrations for it applied from their files: projects' outbox rows go in
 * through `ProjectionD1`, and `FrontPageD1` reads every open ask back out,
 * as the anonymous viewer may take it.
 */
import { describe, expect, it } from "@effect/vitest";
import type { AskListing } from "@repo/protocol/domain/ask";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import {
  AskId,
  DecisionId,
  EnvKey,
  Handle,
  KindName,
  LandedSha,
  ProjectName,
} from "@repo/protocol/ids";
import { DateTime, Effect, Layer, Logger } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { FrontPage } from "../src/front-page.ts";
import type { FrontPageFilter } from "../src/front-page.ts";
import { projectedRows } from "../src/outbox.ts";
import type { OutboxRow } from "../src/project-store/rows.ts";
import { FrontPageD1 } from "../src/projection-d1/front-page.ts";
import { StandingPosturesD1 } from "../src/projection-d1/postures.ts";
import { ProjectionD1 } from "../src/projection-d1/projection.ts";
import {
  FrontPageDdl,
  StandingPosturesDdl,
} from "../src/projection-d1/tables.ts";
import { Projection, ProjectionFailed } from "../src/projection.ts";
import { StandingPostures } from "../src/standing-posture.ts";
import type { StandingEntry } from "../src/standing-posture.ts";
import {
  frontPageMigration,
  migrated,
  migration,
  posturesMigration,
  projectsMigration,
} from "./projection-d1.fixtures.ts";

/**
 * A fresh in-memory database each time, with the projection's migration
 * files applied in order: the front page's, then the project list's and
 * the credits'.
 */
const database = migrated([frontPageMigration, projectsMigration]);

const world = Layer.mergeAll(ProjectionD1, FrontPageD1).pipe(
  Layer.provideMerge(database)
);

const datekit = ProjectName.make("oscabriel/datekit");

const burrow = ProjectName.make("oscabriel/burrow");

const fix = KindName.make("fix");

const lintToZero = KindName.make("lintToZero");

const parseIso = AskId.make("parse-iso");

const weekStart = AskId.make("week-start");

const noAny = AskId.make("no-any");

const landing = LandedSha.make("a".repeat(40));

const at = (minute: number) =>
  DateTime.makeUnsafe(`2026-10-08T09:${String(minute).padStart(2, "0")}:00Z`);

const listing = (
  ask: AskId,
  kind: KindName,
  more: Partial<AskListing> = {}
): AskListing => ({
  ask,
  blockedBy: [],
  claimed: false,
  kind,
  territory: "src",
  want: `${ask} works`,
  ...more,
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

const claimed =
  (ask: AskId) =>
  (seq: number): ProjectEvent =>
    ProjectEvent.cases.Claimed.make({
      ask,
      at: at(30),
      claimant: Handle.make("bram"),
      seq,
    });

const released =
  (ask: AskId) =>
  (seq: number): ProjectEvent =>
    ProjectEvent.cases.Released.make({ ask, at: at(31), seq });

const lapsed =
  (ask: AskId) =>
  (seq: number): ProjectEvent =>
    ProjectEvent.cases.Lapsed.make({ ask, at: at(32), seq });

const warned =
  (ask: AskId) =>
  (seq: number): ProjectEvent =>
    ProjectEvent.cases.Warned.make({ ask, at: at(32), seq });

const closedBy =
  (ask: AskId) =>
  (seq: number): ProjectEvent =>
    ProjectEvent.cases.AskClosed.make({ ask, at: at(40), landing, seq });

const landed =
  (project: ProjectName, ask: AskId) =>
  (seq: number): ProjectEvent =>
    ProjectEvent.cases.Landed.make({
      at: at(40),
      landing: {
        ask,
        assisted: [],
        author: Handle.make("bram"),
        credits: [{ handle: Handle.make("bram"), role: "Signed-off-by" }],
        landedAt: at(40),
        parent: LandedSha.make("b".repeat(40)),
        project,
        sha: landing,
      },
      seq,
    });

const entry = (
  project: ProjectName,
  ask: AskListing,
  takeable: boolean
): FrontPageEntry => ({ ask, posture: "open", project, takeable });

const apply = (batch: Effect.Effect<readonly OutboxRow[]>) =>
  Effect.flatMap(batch, (each) =>
    Projection.use((projection) => projection.apply(each))
  );

const entries = (filter: FrontPageFilter = {}) =>
  FrontPage.use((front) => front.entries(filter));

/** Every row of the projection's tables, to compare a replay against. */
const tables = Effect.gen(function* () {
  const sql = yield* SqlClient;

  return {
    cursor: yield* sql`SELECT * FROM cursor ORDER BY project`,
    frontPage: yield* sql`SELECT * FROM front_page ORDER BY project, ask`,
  };
});

const parseIsoAsk = listing(parseIso, fix);

const weekStartAsk = listing(weekStart, fix, { reserve: "newcomers" });

const noAnyAsk = listing(noAny, lintToZero, { territory: "packages/core" });

describe("the front page's D1 projection", () => {
  it.effect("lists the open asks of every project, claimed or not", () =>
    Effect.gen(function* () {
      yield* apply(
        rows(datekit, 1, [
          opened(parseIsoAsk, 1),
          opened(weekStartAsk, 2),
          claimed(parseIso),
        ])
      );
      yield* apply(rows(burrow, 1, [opened(noAnyAsk, 3)]));

      const parseIsoClaimed = entry(
        datekit,
        { ...parseIsoAsk, claimed: true },
        false
      );

      const weekStartHeld = entry(datekit, weekStartAsk, false);

      const noAnyOpen = entry(burrow, noAnyAsk, true);

      expect(yield* entries()).toStrictEqual([
        noAnyOpen,
        weekStartHeld,
        parseIsoClaimed,
      ]);
      expect(yield* entries({ kind: fix })).toStrictEqual([
        weekStartHeld,
        parseIsoClaimed,
      ]);
      expect(yield* entries({ reserved: "newcomers" })).toStrictEqual([
        weekStartHeld,
      ]);
      expect(yield* entries({ kind: lintToZero })).toStrictEqual([noAnyOpen]);
      expect(yield* entries({ reserved: "people" })).toStrictEqual([]);
    }).pipe(Effect.provide(world))
  );

  it.effect("frees an ask its claim released or let lapse", () =>
    Effect.gen(function* () {
      yield* apply(
        rows(datekit, 1, [
          opened(parseIsoAsk, 1),
          opened(listing(weekStart, fix), 2),
          claimed(parseIso),
          claimed(weekStart),
          warned(weekStart),
          released(parseIso),
          lapsed(weekStart),
        ])
      );

      expect(yield* entries()).toStrictEqual([
        entry(datekit, listing(weekStart, fix), true),
        entry(datekit, parseIsoAsk, true),
      ]);
    }).pipe(Effect.provide(world))
  );

  it.effect("keeps an ask claimed while a second claim on it is live", () =>
    Effect.gen(function* () {
      yield* apply(
        rows(datekit, 1, [
          opened(parseIsoAsk, 1),
          claimed(parseIso),
          claimed(parseIso),
          released(parseIso),
        ])
      );

      expect(yield* entries()).toStrictEqual([
        entry(datekit, { ...parseIsoAsk, claimed: true }, false),
      ]);
    }).pipe(Effect.provide(world))
  );

  it.effect("drops an ask its landing closed", () =>
    Effect.gen(function* () {
      yield* apply(
        rows(datekit, 1, [
          opened(parseIsoAsk, 1),
          opened(weekStartAsk, 2),
          claimed(parseIso),
          landed(datekit, parseIso),
          closedBy(parseIso),
        ])
      );

      expect(yield* entries()).toStrictEqual([
        entry(datekit, weekStartAsk, false),
      ]);
    }).pipe(Effect.provide(world))
  );

  it.effect("shows an ask blocked until the asks it waits on land", () =>
    Effect.gen(function* () {
      const last = listing(noAny, lintToZero, {
        blockedBy: [parseIso, weekStart],
      });

      yield* apply(
        rows(datekit, 1, [
          opened(parseIsoAsk, 1),
          opened(listing(weekStart, fix), 2),
          opened(last, 3),
          closedBy(parseIso),
        ])
      );

      expect(yield* entries({ kind: lintToZero })).toStrictEqual([
        entry(datekit, { ...last, blockedBy: [weekStart] }, false),
      ]);

      yield* apply(rows(datekit, 5, [closedBy(weekStart)]));

      expect(yield* entries({ kind: lintToZero })).toStrictEqual([
        entry(datekit, { ...last, blockedBy: [] }, true),
      ]);
    }).pipe(Effect.provide(world))
  );

  it.effect("changes nothing when the same rows come again", () =>
    Effect.gen(function* () {
      const first = rows(datekit, 1, [
        opened(parseIsoAsk, 1),
        opened(weekStartAsk, 2),
        claimed(parseIso),
      ]);

      yield* apply(first);
      yield* apply(rows(burrow, 1, [opened(noAnyAsk, 3)]));
      yield* apply(rows(datekit, 4, [released(parseIso)]));

      const before = yield* tables;

      yield* apply(first);
      yield* apply(first);

      expect(yield* tables).toStrictEqual(before);
      expect(yield* entries({ kind: fix })).toStrictEqual([
        entry(datekit, weekStartAsk, false),
        entry(datekit, parseIsoAsk, true),
      ]);
    }).pipe(Effect.provide(world))
  );

  it.effect("ignores an older event that arrives after a newer one", () =>
    Effect.gen(function* () {
      yield* apply(
        rows(datekit, 1, [
          opened(parseIsoAsk, 1),
          opened(weekStartAsk, 2),
          claimed(parseIso),
        ])
      );

      const before = yield* tables;

      yield* apply(rows(datekit, 2, [closedBy(weekStart)]));

      expect(yield* tables).toStrictEqual(before);
    }).pipe(Effect.provide(world))
  );

  it.effect(
    "refuses rows past a gap, so the outbox sends the missing one first",
    () =>
      Effect.gen(function* () {
        yield* apply(rows(datekit, 1, [opened(parseIsoAsk, 1)]));

        const before = yield* tables;

        const refused = yield* Effect.flip(
          apply(rows(datekit, 3, [claimed(parseIso)]))
        );

        expect(refused).toBeInstanceOf(ProjectionFailed);
        expect(yield* tables).toStrictEqual(before);

        yield* apply(
          rows(datekit, 2, [opened(weekStartAsk, 2), claimed(parseIso)])
        );

        expect(yield* entries()).toStrictEqual([
          entry(datekit, weekStartAsk, false),
          entry(datekit, { ...parseIsoAsk, claimed: true }, false),
        ]);
      }).pipe(Effect.provide(world))
  );

  it.effect("applies what it can of a batch and refuses only past a gap", () =>
    Effect.gen(function* () {
      const both = yield* Effect.zipWith(
        rows(datekit, 1, [opened(parseIsoAsk, 1)]),
        rows(burrow, 2, [opened(noAnyAsk, 3)]),
        (one, other) => [...one, ...other]
      );

      const refused = yield* Effect.flip(
        Projection.use((projection) => projection.apply(both))
      );

      expect(refused).toBeInstanceOf(ProjectionFailed);
      expect(yield* entries()).toStrictEqual([
        entry(datekit, parseIsoAsk, true),
      ]);
    }).pipe(Effect.provide(world))
  );

  it.effect("reads the migration the platform's D1 applies", () =>
    Effect.gen(function* () {
      expect(yield* migration(frontPageMigration)).toBe(FrontPageDdl);
    })
  );

  // A call without a project (`status`, `today`) reaches each project the
  // projection lists, so it lists every project it has applied events of,
  // even one with no ask open.
  it.effect(
    "lists every project it has heard from, with its open asks, and reads no credits",
    () =>
      Effect.gen(function* () {
        yield* apply(
          rows(datekit, 1, [
            opened(parseIsoAsk, 1),
            opened(weekStartAsk, 2),
            closedBy(weekStart),
          ])
        );
        yield* apply(rows(burrow, 1, [opened(noAnyAsk, 3), closedBy(noAny)]));

        const front = yield* FrontPage;

        expect(yield* front.projects()).toStrictEqual([
          { openAsks: 0, posture: "open", project: burrow },
          { openAsks: 1, posture: "open", project: datekit },
        ]);
        expect(yield* front.credits(Handle.make("bram"))).toStrictEqual([]);
      }).pipe(Effect.provide(world))
  );
});

/** The projection and the kept postures over a database with every migration. */
const withPostures = Layer.mergeAll(ProjectionD1, StandingPosturesD1).pipe(
  Layer.provideMerge(
    migrated([frontPageMigration, projectsMigration, posturesMigration])
  )
);

/** The same over a database the postures' migration has not reached yet. */
const beforePostures = Layer.mergeAll(ProjectionD1, StandingPosturesD1).pipe(
  Layer.provideMerge(migrated([frontPageMigration, projectsMigration]))
);

const sealed: StandingEntry = {
  posture: "openWithSealedEvidence",
  seen: 1,
  until: DateTime.makeUnsafe("2026-10-14T12:00:00Z"),
};

const open: StandingEntry = { posture: "open", seen: 1 };

const keep = (kept: readonly (readonly [ProjectName, StandingEntry])[]) =>
  Effect.flatMap(Effect.service(StandingPostures), (store) =>
    store.put(new Map(kept))
  );

const keptFor = (projects: readonly ProjectName[]) =>
  Effect.flatMap(Effect.service(StandingPostures), (store) =>
    store.get(projects)
  );

const decided = (seq: number): ProjectEvent =>
  ProjectEvent.cases.Decided.make({
    at: at(41),
    choice: "accept",
    decision: DecisionId.make("dec-000001"),
    seq,
  });

const ledgerAppended = (seq: number): ProjectEvent =>
  ProjectEvent.cases.LedgerAppended.make({
    at: at(42),
    entry: LedgerEntry.cases.ValueSet.make({
      at: at(42),
      by: Handle.make("ines-v"),
      key: EnvKey.make("API_KEY"),
      seq: 1,
    }),
    seq,
  });

describe("the kept standing postures in D1", () => {
  it.effect("reads the migration the platform's D1 applies", () =>
    Effect.gen(function* () {
      expect(yield* migration(posturesMigration)).toBe(StandingPosturesDdl);
    })
  );

  it.effect("keeps each project's posture, when it moves and what it saw", () =>
    Effect.gen(function* () {
      yield* keep([
        [datekit, sealed],
        [burrow, open],
      ]);

      expect(
        yield* keptFor([datekit, burrow, ProjectName.make("oscabriel/ghost")])
      ).toStrictEqual(
        new Map([
          [datekit, sealed],
          [burrow, open],
        ])
      );
      expect(yield* keptFor([])).toStrictEqual(new Map());
    }).pipe(Effect.provide(withPostures))
  );

  it.effect(
    "clears a project's posture with each event that can move it, and keeps it through the rest",
    () =>
      Effect.gen(function* () {
        const after = (event: (seq: number) => ProjectEvent, seq: number) =>
          Effect.gen(function* () {
            yield* keep([
              [datekit, { ...open, seen: seq - 1 }],
              [burrow, open],
            ]);
            yield* apply(rows(datekit, seq, [event]));

            return [...(yield* keptFor([datekit, burrow])).keys()].toSorted();
          });

        expect([
          yield* after(opened(parseIsoAsk, 1), 1),
          yield* after(claimed(parseIso), 2),
          yield* after(landed(datekit, parseIso), 3),
          yield* after(decided, 4),
          yield* after(ledgerAppended, 5),
          yield* after(closedBy(parseIso), 6),
        ]).toStrictEqual([
          [burrow, datekit],
          [burrow, datekit],
          [burrow],
          [burrow],
          [burrow],
          [burrow, datekit],
        ]);
      }).pipe(Effect.provide(withPostures))
  );

  it.effect(
    "keeps nothing from a read the projection has since moved past, nor an older read over a newer",
    () =>
      Effect.gen(function* () {
        yield* apply(
          rows(datekit, 1, [opened(parseIsoAsk, 1), claimed(parseIso)])
        );

        // Read when datekit had one event; the projection has applied two.
        yield* keep([[datekit, { ...open, seen: 1 }]]);

        const stale = yield* keptFor([datekit]);

        yield* keep([[datekit, { ...sealed, seen: 2 }]]);
        yield* keep([[datekit, { ...open, seen: 2 }]]);
        yield* keep([[burrow, { ...open, seen: 3 }]]);
        yield* keep([[burrow, { ...sealed, seen: 2 }]]);

        expect({
          kept: yield* keptFor([datekit, burrow]),
          stale,
        }).toStrictEqual({
          kept: new Map([
            [datekit, { ...open, seen: 2 }],
            [burrow, { ...open, seen: 3 }],
          ]),
          stale: new Map(),
        });
      }).pipe(Effect.provide(withPostures))
  );

  it.effect(
    "before its migration, projects every event and keeps nothing, with a warning",
    () =>
      Effect.gen(function* () {
        const warnings: string[] = [];

        const keeper = Logger.make(({ logLevel, message }) => {
          warnings.push(`${logLevel}: ${String(message)}`);
        });

        yield* Effect.gen(function* () {
          yield* apply(
            rows(datekit, 1, [
              opened(parseIsoAsk, 1),
              landed(datekit, parseIso),
              decided,
            ])
          );
          yield* keep([[datekit, { ...open, seen: 3 }]]);

          expect(yield* keptFor([datekit])).toStrictEqual(new Map());

          const cursor = yield* Effect.flatMap(
            Effect.service(SqlClient),
            (sql) => sql<{ readonly seq: number }>`SELECT seq FROM cursor`
          );

          expect(cursor.map(({ seq }) => seq)).toStrictEqual([3]);
        }).pipe(Effect.provide(Logger.layer([keeper])));

        expect(warnings.map((line) => line.split(":")[0])).toStrictEqual([
          "Warn",
          "Warn",
        ]);
      }).pipe(Effect.provide(beforePostures))
  );
});
