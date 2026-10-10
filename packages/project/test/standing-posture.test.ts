/**
 * A listed project's posture, as its own record says it now: each listing
 * the projection gives is overlaid with the posture its project's ledger
 * stands at, read as anyone reads it, a few projects at once. A project the
 * platform never made, or one whose read breaks, keeps the posture the
 * projection listed, and the list still answers.
 */
import { describe, expect, it } from "@effect/vitest";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { Principal } from "@repo/protocol/principal";
import { UnknownProject } from "@repo/protocol/refusal";
import { untouchable } from "@repo/testkit/untouchable";
import { Array, DateTime, Duration, Effect, Layer, Logger, Ref } from "effect";

import type { ProjectApi } from "../src/project.ts";
import { Projects } from "../src/projects.ts";
import { withStandingPosture } from "../src/standing-posture.ts";

const datekit = ProjectName.make("datekit");

const ghost = ProjectName.make("ghost");

const broken = ProjectName.make("broken");

const burrow = ProjectName.make("burrow");

const landedAt = DateTime.makeUnsafe("2026-10-08T12:00:00Z");

/**
 * An api whose only answered read is `ledger`, standing at `posture` for
 * anyone; a person's read is a defect, since a listing is public.
 */
const standingAt = (
  project: ProjectName,
  posture: Posture,
  before: Effect.Effect<void> = Effect.void
) =>
  untouchable<ProjectApi>("ProjectApi", {
    ledger: (caller) =>
      Principal.match(caller, {
        Anonymous: () =>
          Effect.as(before, {
            entries: [],
            layers: [],
            posture,
            postureLabel: "As its ledger says",
            project,
          }),
        Person: ({ handle }) =>
          Effect.die(`a listing read ${project}'s ledger as ${handle}`),
      }),
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
              ledger: () => Effect.die("the project's storage is down"),
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
          "Warn: broken's posture is the projection's: its ledger was not read",
          "Warn: ghost's posture is the projection's: its ledger was not read",
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
        project: ProjectName.make(`p${at}`),
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
