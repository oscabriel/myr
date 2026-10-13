import { describe, expect, it } from "@effect/vitest";
import { ProjectDescription } from "@repo/protocol/domain/front-page";
import { ProjectName } from "@repo/protocol/ids";
import { DateTime, Effect, Layer, Logger, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

import { ProjectDescriptions } from "../src/description.ts";
import type { KeptDescription } from "../src/description.ts";
import { ProjectDescriptionsD1 } from "../src/projection-d1/descriptions.ts";
import { ProjectDescriptionsDdl } from "../src/projection-d1/tables.ts";
import {
  descriptionsMigration,
  migrated,
  migration,
} from "./projection-d1.fixtures.ts";

const datekit = ProjectName.make("alice/datekit");

const burrow = ProjectName.make("alice/burrow");

const at = DateTime.makeUnsafe("2026-10-12T12:00:00Z");

const helpers: KeptDescription = {
  description: Schema.decodeSync(ProjectDescription)("Date helpers."),
  landedAt: at,
};

const keptFor = (projects: readonly ProjectName[]) =>
  Effect.flatMap(Effect.service(ProjectDescriptions), (store) =>
    store.get(projects)
  );

const keep = (entries: readonly (readonly [ProjectName, KeptDescription])[]) =>
  Effect.flatMap(Effect.service(ProjectDescriptions), (store) =>
    store.put(new Map(entries))
  );

describe("the kept descriptions in D1", () => {
  it.effect("reads the migration the platform's D1 applies", () =>
    Effect.gen(function* () {
      expect(yield* migration(descriptionsMigration)).toBe(
        ProjectDescriptionsDdl
      );
    })
  );

  it.effect(
    "keeps each project's description beside the landing it read, and a README with none",
    () =>
      Effect.gen(function* () {
        yield* keep([
          [datekit, helpers],
          [burrow, { landedAt: at }],
        ]);

        expect(yield* keptFor([datekit, burrow])).toStrictEqual(
          new Map([
            [datekit, helpers],
            [burrow, { landedAt: at }],
          ])
        );
      }).pipe(
        Effect.provide(
          ProjectDescriptionsD1.pipe(
            Layer.provideMerge(migrated([descriptionsMigration]))
          )
        )
      )
  );

  it.effect("reads a kept row that no longer decodes as a miss", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient;

      yield* sql`INSERT INTO project_descriptions (project, landed_at, description)
        VALUES ('alice__datekit', '2026-10-12T12:00:00.000Z', ${"x".repeat(161)})`;

      expect(yield* keptFor([datekit])).toStrictEqual(new Map());
    }).pipe(
      Effect.provide(
        ProjectDescriptionsD1.pipe(
          Layer.provideMerge(migrated([descriptionsMigration]))
        )
      )
    )
  );

  it.effect("misses, never fails, before the migration has run", () =>
    Effect.gen(function* () {
      yield* keep([[datekit, helpers]]);

      expect(yield* keptFor([datekit])).toStrictEqual(new Map());
    }).pipe(
      Effect.provide(
        ProjectDescriptionsD1.pipe(Layer.provideMerge(migrated([])))
      ),
      Effect.provide(Logger.layer([]))
    )
  );
});
