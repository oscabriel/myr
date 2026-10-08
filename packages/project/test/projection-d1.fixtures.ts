/**
 * The platform's D1 database as the projection's tests make it: migration
 * files read from `apps/platform/migrations` and run statement by statement
 * on a fresh sqlite-node database in memory, as `wrangler d1 migrations
 * apply` runs them in order.
 */
import { NodeServices } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Effect, FileSystem, Layer, Path } from "effect";
import { SqlClient } from "effect/sql/SqlClient";

/** The front page's migration (W3 309; `FrontPageDdl`). */
export const frontPageMigration = "0001_front_page.sql";

/** The project list's and the credits' migration (W5 514; `ProjectsCreditsDdl`). */
export const projectsMigration = "0004_projects_credits.sql";

/** A migration of the platform's D1 database, as its file holds it. */
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

/** Runs a migration's statements in order. */
export const applied = (file: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;

    for (const statement of (yield* migration(file)).split(";")) {
      if (statement.trim().length > 0) {
        yield* sql.unsafe(statement);
      }
    }
  }).pipe(Effect.orDie);

/** A fresh in-memory database each time, with `files` applied in order. */
export const migrated = (files: readonly string[]) =>
  Layer.effectDiscard(Effect.forEach(files, applied, { discard: true })).pipe(
    Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
    Layer.orDie
  );
