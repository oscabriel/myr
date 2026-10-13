import { NodeServices } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Effect, FileSystem, Layer, Path } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

export const frontPageMigration = "0001_front_page.sql";

export const projectsMigration = "0004_projects_credits.sql";

export const posturesMigration = "0005_standing_postures.sql";

export const descriptionsMigration = "0007_project_descriptions.sql";

export const migration = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return yield* fs.readFileString(
      yield* path.fromFileUrl(
        new URL(`../../../apps/platform/migrations/${file}`, import.meta.url)
      )
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

export const applied = (file: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    for (const statement of (yield* migration(file)).split(";")) {
      if (statement.trim().length > 0) {
        yield* sql.unsafe(statement);
      }
    }
  }).pipe(Effect.orDie);

export const migrated = (files: readonly string[]) =>
  Layer.effectDiscard(Effect.forEach(files, applied, { discard: true })).pipe(
    Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
    Layer.orDie
  );

export const recentLandingsMigration = "0008_recent_landings.sql";
