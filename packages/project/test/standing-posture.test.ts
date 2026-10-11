/**
 * A listed project's posture, as its own record says it now: each listing
 * the projection gives is overlaid with the posture its project's ledger
 * stands at, a few projects at once. A project the platform never made, or
 * one whose read breaks, keeps the posture the projection listed, and the
 * list still answers. What was read is kept (`StandingPostures`) until the
 * instant it moves by the clock, so a second list reads only the projects
 * whose kept posture ran out; a store that fails is a miss.
 */
import { describe, expect, it } from "@effect/vitest";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import { DecisionId, Handle, LandedSha, ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { UnknownProject } from "@repo/protocol/refusal";
import { untouchable } from "@repo/testkit/untouchable";
import {
  Array,
  DateTime,
  Duration,
  Effect,
  Layer,
  Logger,
  Option,
  Ref,
} from "effect";
import { TestClock } from "effect/testing";

import { projectedRows } from "../src/outbox.ts";
import type { ProjectApi } from "../src/project.ts";
import { StandingPosturesD1 } from "../src/projection-d1/postures.ts";
import { ProjectionD1 } from "../src/projection-d1/projection.ts";
import { Projection } from "../src/projection.ts";
import { Projects } from "../src/projects.ts";
import {
  StandingPostures,
  withStandingPosture,
} from "../src/standing-posture.ts";
import { StandingPosturesMemory } from "../src/standing-posture/memory.ts";
import {
  frontPageMigration,
  migrated,
  posturesMigration,
  projectsMigration,
} from "./projection-d1.fixtures.ts";

const datekit = ProjectName.make("alice/datekit");

const ghost = ProjectName.make("alice/ghost");

const broken = ProjectName.make("alice/broken");

const burrow = ProjectName.make("alice/burrow");

const landedAt = DateTime.makeUnsafe("2026-10-08T12:00:00Z");

/**
 * An api whose only answered read is `standing`, at `posture`, having seen
 * 7 events, moving by the clock at `until` when given.
 */
const standingAt = (
  project: ProjectName,
  posture: Posture,
  before: Effect.Effect<void> = Effect.void,
  until: Option.Option<DateTime.Utc> = Option.none()
) =>
  untouchable<ProjectApi>("ProjectApi", {
    standing: () =>
      Effect.as(
        before,
        Option.match(until, {
          onNone: () => ({ posture, seen: 7 }),
          onSome: (at) => ({ posture, seen: 7, until: at }),
        })
      ),
  });

/**
 * The platform's projects: datekit's ledger stands sealed, burrow's open,
 * `broken`'s read dies, and `ghost` was never made.
 */
const platform = Layer.succeed(
  Projects,
  Projects.of({
    create: () => Effect.die("a listing makes no project"),
    get: (project) => {
      switch (project) {
        case datekit: {
          return Effect.succeed(standingAt(datekit, "openWithSealedEvidence"));
        }

        case burrow: {
          return Effect.succeed(standingAt(burrow, "open"));
        }

        case broken: {
          return Effect.succeed(
            untouchable<ProjectApi>("ProjectApi", {
              standing: () => Effect.die("the project's storage is down"),
            })
          );
        }

        default: {
          return Effect.fail(new UnknownProject({ project }));
        }
      }
    },
  })
);

const listed: readonly ProjectListing[] = [
  { landedAt, openAsks: 3, posture: "open", project: datekit },
  { openAsks: 1, posture: "openCore", project: ghost },
  { openAsks: 0, posture: "sourceAvailable", project: broken },
  { landedAt, openAsks: 2, posture: "openOnSchedule", project: burrow },
];

/** The projects as `listed` stands them, `datekit` sealed and `burrow` open. */
const standingListed = [
  {
    landedAt,
    openAsks: 3,
    posture: "openWithSealedEvidence",
    project: datekit,
  },
  { openAsks: 1, posture: "openCore", project: ghost },
  { openAsks: 0, posture: "sourceAvailable", project: broken },
  { landedAt, openAsks: 2, posture: "open", project: burrow },
] satisfies readonly ProjectListing[];

/** One hour past the TestClock's start: when datekit's narrowing takes effect, below. */
const inAnHour = DateTime.makeUnsafe(Duration.toMillis(Duration.hours(1)));

/**
 * `platform`, each project's `standing` read counted in `reads`; datekit's
 * moves by the clock at `datekitUntil`.
 */
const counted = (
  reads: Ref.Ref<readonly ProjectName[]>,
  datekitUntil: Option.Option<DateTime.Utc> = Option.none()
) =>
  Layer.succeed(
    Projects,
    Projects.of({
      create: () => Effect.die("a listing makes no project"),
      get: (project) => {
        const read = Ref.update(reads, (all) => [...all, project]);

        switch (project) {
          case datekit: {
            return Effect.succeed(
              standingAt(datekit, "openWithSealedEvidence", read, datekitUntil)
            );
          }

          case burrow: {
            return Effect.succeed(standingAt(burrow, "open", read));
          }

          case broken: {
            return Effect.succeed(
              untouchable<ProjectApi>("ProjectApi", {
                standing: () =>
                  Effect.andThen(read, Effect.die("the storage is down")),
              })
            );
          }

          default: {
            return Effect.fail(new UnknownProject({ project }));
          }
        }
      },
    })
  );

/** A store whose every read and write dies. */
const brokenStore = Layer.succeed(StandingPostures, {
  get: () => Effect.die("D1 is down"),
  put: () => Effect.die("D1 is down"),
});

describe("a listing's standing posture", () => {
  it.effect("reads each project's posture from its own ledger", () =>
    Effect.gen(function* () {
      const standing = yield* withStandingPosture(listed);

      expect(standing).toStrictEqual([
        {
          landedAt,
          openAsks: 3,
          posture: "openWithSealedEvidence",
          project: datekit,
        },
        { openAsks: 1, posture: "openCore", project: ghost },
        { openAsks: 0, posture: "sourceAvailable", project: broken },
        { landedAt, openAsks: 2, posture: "open", project: burrow },
      ]);
    }).pipe(Effect.provide(platform))
  );

  it.effect(
    "warns once for each project whose posture stays the projection's",
    () =>
      Effect.gen(function* () {
        const warned: string[] = [];

        const keeper = Logger.make(({ logLevel, message }) => {
          warned.push(`${logLevel}: ${String(message)}`);
        });

        yield* withStandingPosture(listed).pipe(
          Effect.provide(Logger.layer([keeper]))
        );

        expect(warned.toSorted()).toStrictEqual([
          "Warn: alice/broken's posture is the projection's: its ledger was not read",
          "Warn: alice/ghost's posture is the projection's: its ledger was not read",
        ]);
      }).pipe(Effect.provide(platform))
  );

  it.effect("lists nothing for an empty list, and asks no project", () =>
    Effect.gen(function* () {
      expect(yield* withStandingPosture([])).toStrictEqual([]);
    }).pipe(
      Effect.provide(
        Layer.succeed(Projects, untouchable<Projects["Service"]>("Projects"))
      )
    )
  );

  it.live("reads at most 8 projects at once", () =>
    Effect.gen(function* () {
      const under = yield* Ref.make(0);
      const peak = yield* Ref.make(0);

      const timed = Effect.acquireUseRelease(
        Ref.updateAndGet(under, (count) => count + 1).pipe(
          Effect.tap((count) =>
            Ref.update(peak, (most) => Math.max(most, count))
          )
        ),
        () => Effect.sleep(Duration.millis(10)),
        () => Ref.update(under, (count) => count - 1)
      );

      const many = Array.makeBy(20, (at): ProjectListing => ({
        openAsks: at,
        posture: "open",
        project: ProjectName.make(`alice/p${at}`),
      }));

      const standing = yield* withStandingPosture(many).pipe(
        Effect.provide(
          Layer.succeed(
            Projects,
            Projects.of({
              create: () => Effect.die("a listing makes no project"),
              get: (project) =>
                Effect.succeed(standingAt(project, "openCore", timed)),
            })
          )
        )
      );

      expect(standing).toStrictEqual(
        many.map((listing) => ({ ...listing, posture: "openCore" }))
      );
      expect(yield* Ref.get(peak)).toBe(8);
    })
  );
});

describe("a listing's kept standing posture", () => {
  it.effect("is read once: a second list reads no project", () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make<readonly ProjectName[]>([]);

      const twice = yield* Effect.all([
        withStandingPosture(listed),
        withStandingPosture(listed),
      ]).pipe(
        Effect.provide(Layer.merge(counted(reads), StandingPosturesMemory))
      );

      expect(twice).toStrictEqual([standingListed, standingListed]);
      // ghost was never made and broken's read fails: neither is kept, so
      // each is asked again; datekit and burrow were kept.
      expect((yield* Ref.get(reads)).toSorted()).toStrictEqual([
        broken,
        broken,
        burrow,
        datekit,
      ]);
    })
  );

  it.effect(
    "keeps what it read, with the instant it moves and the event it saw",
    () =>
      Effect.gen(function* () {
        const reads = yield* Ref.make<readonly ProjectName[]>([]);

        const kept = yield* Effect.gen(function* () {
          yield* withStandingPosture(listed);

          const store = yield* StandingPostures;

          return yield* store.get([datekit, ghost, broken, burrow]);
        }).pipe(
          Effect.provide(
            Layer.merge(
              counted(reads, Option.some(inAnHour)),
              StandingPosturesMemory
            )
          )
        );

        expect(kept).toStrictEqual(
          new Map([
            [
              datekit,
              { posture: "openWithSealedEvidence", seen: 7, until: inAnHour },
            ],
            [burrow, { posture: "open", seen: 7 }],
          ])
        );
      })
  );

  it.effect(
    "is read again once the instant it moves by the clock has come",
    () =>
      Effect.gen(function* () {
        const reads = yield* Ref.make<readonly ProjectName[]>([]);

        yield* Effect.gen(function* () {
          yield* withStandingPosture(listed);
          yield* TestClock.adjust(Duration.minutes(59));
          yield* withStandingPosture(listed);

          // The first list read both; the second, inside the hour, neither.
          expect(
            (yield* Ref.get(reads)).filter((at) => at !== broken).toSorted()
          ).toStrictEqual([burrow, datekit]);

          yield* TestClock.adjust(Duration.minutes(1));
          yield* Ref.set(reads, []);
          yield* withStandingPosture(listed);
        }).pipe(
          Effect.provide(
            Layer.merge(
              counted(reads, Option.some(inAnHour)),
              StandingPosturesMemory
            )
          )
        );

        expect(
          (yield* Ref.get(reads)).filter((at) => at !== broken)
        ).toStrictEqual([datekit]);
      })
  );

  it.effect(
    "lists every project with its standing when the store cannot be read or written",
    () =>
      Effect.gen(function* () {
        const reads = yield* Ref.make<readonly ProjectName[]>([]);

        const standing = yield* withStandingPosture(listed).pipe(
          Effect.provide(Layer.merge(counted(reads), brokenStore))
        );

        expect(standing).toStrictEqual(standingListed);
      })
  );
});

/** The kept postures and the projection over the platform's D1, in sqlite. */
const d1 = Layer.mergeAll(StandingPosturesD1, ProjectionD1).pipe(
  Layer.provideMerge(
    migrated([frontPageMigration, projectsMigration, posturesMigration])
  )
);

/** One event of `project`'s, as the projection is handed it from the outbox. */
const projected = (project: ProjectName, event: ProjectEvent) =>
  Effect.flatMap(projectedRows(project, [event], landedAt), (rows) =>
    Projection.use((projection) => projection.apply(rows))
  );

describe("a listing's standing posture kept in D1 beside the projection", () => {
  it.effect(
    "is read again only for the project whose event the projection applied",
    () =>
      Effect.gen(function* () {
        const reads = yield* Ref.make<readonly ProjectName[]>([]);

        yield* Effect.gen(function* () {
          /** One list; the projects it read, but broken, whose read always fails. */
          const list = Effect.gen(function* () {
            yield* Ref.set(reads, []);

            expect(yield* withStandingPosture(listed)).toStrictEqual(
              standingListed
            );

            return (yield* Ref.get(reads))
              .filter((at) => at !== broken)
              .toSorted();
          });

          const first = yield* list;
          const warm = yield* list;

          yield* projected(
            datekit,
            ProjectEvent.cases.Landed.make({
              at: landedAt,
              landing: {
                assisted: [],
                author: Handle.make("bram"),
                credits: [],
                landedAt,
                parent: LandedSha.make("b".repeat(40)),
                project: datekit,
                sha: LandedSha.make("a".repeat(40)),
              },
              seq: 1,
            })
          );

          const afterLanding = yield* list;

          yield* projected(
            burrow,
            ProjectEvent.cases.LedgerAppended.make({
              at: landedAt,
              entry: LedgerEntry.cases.PostureChanged.make({
                at: landedAt,
                decision: DecisionId.make("dec-000001"),
                from: "openCore",
                seq: 1,
                to: "open",
              }),
              seq: 1,
            })
          );

          expect([first, warm, afterLanding, yield* list]).toStrictEqual([
            [burrow, datekit],
            [],
            [datekit],
            [burrow],
          ]);
        }).pipe(Effect.provide(Layer.merge(counted(reads), d1)));
      })
  );
});
