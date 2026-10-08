/**
 * The ledger of throwaway resources (issue 701): every namespace, repo or
 * project a smoke run, a swarm run or a `seed --as` copy makes on a stage is
 * written to `infra/created.jsonl`, so teardown (808) acts only on what this
 * build made.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, FileSystem, Path } from "effect";

import {
  ledgerPath,
  LedgerFile,
  readLedger,
  recordCreated,
  throwawayName,
} from "../../../infra/created.ts";
import type { Created } from "../../../infra/created.ts";
import { repoRoot } from "./root.ts";

const smokeRepo: Created = {
  at: DateTime.makeUnsafe("2026-10-13T09:00:00Z"),
  by: "smoke",
  kind: "repo",
  name: "smoke-r1",
  namespace: "projects-dev-oscabriel",
  stage: "dev-oscabriel",
};

const swarmProject: Created = {
  at: DateTime.makeUnsafe("2026-10-13T09:05:00Z"),
  by: "swarm",
  kind: "project",
  name: "swarm-r2",
  stage: "dev-oscabriel",
};

/** A fresh ledger file in a temp dir, for the scope of one test. */
const tempLedger = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "ledger-701-" });

  return path.join(dir, "created.jsonl");
});

describe("the throwaway ledger", () => {
  it.live("appends one JSON line per entry and reads them back in order", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const file = yield* tempLedger;

      const read = yield* Effect.gen(function* () {
        yield* recordCreated(smokeRepo);
        yield* recordCreated(swarmProject);

        return yield* readLedger;
      }).pipe(Effect.provideService(LedgerFile, file));

      expect({
        lines: (yield* fs
          .readFileString(file)
          .pipe(Effect.orElseSucceed(() => ""))).split("\n"),
        read,
      }).toStrictEqual({
        lines: [
          '{"at":"2026-10-13T09:00:00.000Z","by":"smoke","kind":"repo","name":"smoke-r1","namespace":"projects-dev-oscabriel","stage":"dev-oscabriel"}',
          '{"at":"2026-10-13T09:05:00.000Z","by":"swarm","kind":"project","name":"swarm-r2","stage":"dev-oscabriel"}',
          "",
        ],
        read: [smokeRepo, swarmProject],
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("writes the repo's own ledger unless a test points elsewhere", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const root = yield* repoRoot;

      expect(yield* LedgerFile).toBe(path.join(root, ledgerPath));
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("reads a ledger no run has written yet as empty", () =>
    Effect.gen(function* () {
      const file = yield* tempLedger;

      expect(
        yield* readLedger.pipe(Effect.provideService(LedgerFile, file))
      ).toStrictEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("fails on a line that is not a Created entry", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const file = yield* tempLedger;

      yield* fs.writeFileString(
        file,
        '{"at":"2026-10-13T09:00:00.000Z","by":"smoke","kind":"repo","name":"smoke-r1","stage":"dev-oscabriel"}\n{"by":"bench","kind":"repo","name":"bench-r1"}\n'
      );

      const error = yield* readLedger.pipe(
        Effect.provideService(LedgerFile, file),
        Effect.flip
      );

      expect(error._tag).toBe("SchemaError");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it("names a throwaway by the run that made it, never by the brand", () => {
    expect([
      throwawayName("smoke", "r1"),
      throwawayName("swarm", "r2"),
    ]).toStrictEqual(["smoke-r1", "swarm-r2"]);
  });
});
