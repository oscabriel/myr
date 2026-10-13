import { describe, expect, it } from "@effect/vitest";
import type { AskListing } from "@repo/protocol/domain/ask";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { Outcome } from "@repo/protocol/domain/outcome";
import { RECENT_LANDINGS_CAP } from "@repo/protocol/domain/recent-landing";
import type { RecentLanding } from "@repo/protocol/domain/recent-landing";
import {
  AskId,
  CommitSha,
  Handle,
  KindName,
  LandedSha,
  ProjectName,
  RepoPath,
} from "@repo/protocol/ids";
import {
  ChecksFailed,
  HeldBackFailed,
  OutOfScope,
} from "@repo/protocol/refusal";
import { DateTime, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { FrontPage } from "../src/front-page.ts";
import { projectedRows } from "../src/outbox.ts";
import { FrontPageD1 } from "../src/projection-d1/front-page.ts";
import { ProjectionD1 } from "../src/projection-d1/projection.ts";
import { RecentLandingsDdl } from "../src/projection-d1/tables.ts";
import { Projection } from "../src/projection.ts";
import {
  frontPageMigration,
  migrated,
  migration,
  projectsMigration,
  recentLandingsMigration,
} from "./projection-d1.fixtures.ts";

const world = Layer.mergeAll(ProjectionD1, FrontPageD1).pipe(
  Layer.provideMerge(
    migrated([frontPageMigration, projectsMigration, recentLandingsMigration])
  )
);

const beforeRecentLandings = Layer.mergeAll(ProjectionD1, FrontPageD1).pipe(
  Layer.provideMerge(migrated([frontPageMigration, projectsMigration]))
);

const datekit = ProjectName.make("alice/datekit");

const burrow = ProjectName.make("alice/burrow");

const parseIso = AskId.make("parse-iso");

const trimInput = AskId.make("trim-input");

const head = CommitSha.make("c".repeat(40));

const shaOf = (seq: number) =>
  LandedSha.make(seq.toString(16).padStart(40, "0"));

const at = (minute: number) =>
  DateTime.makeUnsafe(
    `2026-10-08T${String(9 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00Z`
  );

const listing = (ask: AskId, want: string): AskListing => ({
  ask,
  blockedBy: [],
  claimed: false,
  kind: KindName.make("fix"),
  territory: "src",
  want,
});

const opened =
  (ask: AskId, want: string, minute: number) =>
  (seq: number): ProjectEvent =>
    ProjectEvent.cases.AskOpened.make({
      ask: listing(ask, want),
      at: at(minute),
      seq,
    });

const landed =
  (
    project: ProjectName,
    minute: number,
    asks: { readonly ask?: AskId; readonly opened?: AskId } = {}
  ) =>
  (seq: number): ProjectEvent =>
    ProjectEvent.cases.Landed.make({
      at: at(minute),
      landing: {
        ...asks,
        assisted: [],
        author: Handle.make("bram"),
        credits: [],
        landedAt: at(minute),
        project,
        sha: shaOf(minute),
      },
      seq,
    });

const closed =
  (ask: AskId, minute: number) =>
  (seq: number): ProjectEvent =>
    ProjectEvent.cases.AskClosed.make({
      ask,
      at: at(minute),
      landing: shaOf(minute),
      seq,
    });

const refused =
  (ask: AskId, minute: number) =>
  (seq: number): ProjectEvent =>
    ProjectEvent.cases.Judged.make({
      ask,
      at: at(minute),
      head,
      outcome: Outcome.cases.Refused.make({
        refusals: [
          new HeldBackFailed({ area: "parser", suite: "edge-cases" }),
          new ChecksFailed({ lane: "unit", logRef: "logs/7", next: "bun test" }),
          new OutOfScope({ paths: [RepoPath.make("src/secret.ts")] }),
        ],
      }),
      seq,
    });

const checking =
  (ask: AskId, minute: number) =>
  (seq: number): ProjectEvent =>
    ProjectEvent.cases.Judged.make({
      ask,
      at: at(minute),
      head,
      outcome: Outcome.cases.Checking.make({ stage: "checks" }),
      seq,
    });

const apply = (
  project: ProjectName,
  first: number,
  events: readonly ((seq: number) => ProjectEvent)[]
) =>
  Effect.flatMap(
    projectedRows(
      project,
      events.map((event, index) => event(first + index)),
      at(0)
    ),
    (rows) => Projection.use((projection) => projection.apply(rows))
  );

const recent = FrontPage.use((front) => front.recentLandings());

const keptRows = Effect.flatMap(Effect.service(SqlClient), (sql) =>
  Effect.map(
    sql`SELECT project, seq FROM recent_landings`,
    (rows) => rows.length
  )
);

const datekitStory = [
  opened(parseIso, "Parse ISO week dates", 1),
  opened(trimInput, "Trim input before parsing", 2),
  checking(trimInput, 3),
  refused(trimInput, 4),
  landed(datekit, 5, { ask: parseIso }),
  closed(parseIso, 5),
];

const parseIsoLanded: RecentLanding = {
  _tag: "Landed",
  answered: parseIso,
  at: at(5),
  project: datekit,
  sha: shaOf(5),
  want: "Parse ISO week dates",
};

const trimInputRefused: RecentLanding = {
  _tag: "Refused",
  ask: trimInput,
  at: at(4),
  project: datekit,
  refusals: [
    { area: "parser", tag: "HeldBackFailed" },
    { tag: "ChecksFailed" },
    { tag: "OutOfScope" },
  ],
  want: "Trim input before parsing",
};

describe("the recent landings' D1 projection", () => {
  it.effect("reads the migration the platform's D1 applies", () =>
    Effect.gen(function* () {
      expect(yield* migration(recentLandingsMigration)).toBe(
        RecentLandingsDdl
      );
    })
  );

  it.effect(
    "lists the landings and refused answers of every project, the latest first, each with its ask's want, a refusal by its tag and area alone",
    () =>
      Effect.gen(function* () {
        yield* apply(datekit, 1, datekitStory);
        yield* apply(burrow, 1, [landed(burrow, 3)]);

        expect(yield* recent).toStrictEqual([
          parseIsoLanded,
          trimInputRefused,
          { _tag: "Landed", at: at(3), project: burrow, sha: shaOf(3) },
        ]);
      }).pipe(Effect.provide(world))
  );

  it.effect("names the ask a landing opened, with its want", () =>
    Effect.gen(function* () {
      yield* apply(datekit, 1, [
        landed(datekit, 1, { opened: parseIso }),
        opened(parseIso, "Parse ISO week dates", 1),
      ]);

      expect(yield* recent).toStrictEqual([
        {
          _tag: "Landed",
          at: at(1),
          opened: parseIso,
          project: datekit,
          sha: shaOf(1),
          want: "Parse ISO week dates",
        },
      ]);
    }).pipe(Effect.provide(world))
  );

  it.effect(
    `keeps and lists only the latest ${RECENT_LANDINGS_CAP}, however many landed`,
    () =>
      Effect.gen(function* () {
        const minutes = Array.from(
          { length: RECENT_LANDINGS_CAP + 5 },
          (_, index) => index + 1
        );

        yield* apply(
          datekit,
          1,
          minutes.map((minute) => landed(datekit, minute))
        );

        const listed = yield* recent;

        expect(listed.map(({ at: when }) => when)).toStrictEqual(
          minutes.toReversed().slice(0, RECENT_LANDINGS_CAP).map(at)
        );
        expect(yield* keptRows).toBe(RECENT_LANDINGS_CAP);
      }).pipe(Effect.provide(world))
  );

  it.effect("changes nothing when the same rows come again", () =>
    Effect.gen(function* () {
      yield* apply(datekit, 1, datekitStory);
      yield* apply(datekit, 1, datekitStory);

      expect(yield* recent).toStrictEqual([parseIsoLanded, trimInputRefused]);
    }).pipe(Effect.provide(world))
  );

  it.effect(
    "projects as before on a database the migration has not reached",
    () =>
      Effect.gen(function* () {
        yield* apply(datekit, 1, datekitStory);

        expect(yield* FrontPage.use((front) => front.projects())).toStrictEqual(
          [
            {
              landedAt: at(5),
              openAsks: 1,
              posture: "open",
              project: datekit,
            },
          ]
        );
      }).pipe(Effect.provide(beforeRecentLandings))
  );
});
