import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { ProjectStore } from "../src/project-store.ts";
import { migrate } from "../src/project-store/migrations.ts";
import { ProjectStoreSqlite } from "../src/project-store/sqlite.ts";
import { describeProjectStore } from "./project-store.contract.ts";

const database = SqliteClient.layer({ filename: ":memory:" }).pipe(Layer.orDie);

describeProjectStore(
  "sqlite",
  ProjectStoreSqlite.pipe(Layer.provide(database))
);

describe("the project store's migrations", () => {
  it.effect("run each migration once on a fresh database", () =>
    Effect.gen(function* () {
      expect(yield* migrate).toStrictEqual([
        [1, "project_state"],
        [2, "visibility"],
        [3, "discussions"],
      ]);
      expect(yield* migrate).toStrictEqual([]);
    }).pipe(Effect.provide(database))
  );

  it.effect("run again over a store's rows, change nothing", () =>
    Effect.gen(function* () {
      const store = yield* ProjectStore;

      yield* store.commit({ queue: { order: [] } });

      expect(yield* migrate).toStrictEqual([]);
      expect((yield* store.load()).queue).toStrictEqual({ order: [] });
    }).pipe(Effect.provide(Layer.provideMerge(ProjectStoreSqlite, database)))
  );
});
