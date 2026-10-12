/**
 * Usage:
 *   bun scripts/import-examples.ts --world node [--only <p>]
 *   bunx varlock run --path apps/platform/ -- \
 *     bun scripts/import-examples.ts --stage <stage> [--only <p>] [--warm] [--sources] [--dry-run]
 *   `--tags` also needs the ops credentials: `bunx varlock run --path infra/ -- …`.
 *
 * `--tags` is the one write that skips the gateway: tags only, never `main`.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Layer, Option, Stdio } from "effect";

import { worldTarget, restBackfill, stageTarget } from "./lib/import/live.ts";
import {
  ImportWhere,
  importExamples,
  ImportExamplesFailed,
  TagBackfill,
} from "./lib/import/run.ts";
import type { ImportOptions } from "./lib/import/run.ts";

const noBackfill = Layer.succeed(
  TagBackfill,
  TagBackfill.of({
    backfill: () =>
      Effect.fail(new ImportExamplesFailed({ reason: "--tags was not given" })),
  })
);

const layersOf = (options: ImportOptions) =>
  ImportWhere.match(options.where, {
    Stage: ({ stage, url }) =>
      Layer.mergeAll(
        stageTarget(stage, url, Option.getOrUndefined(options.web)),
        options.tags ? restBackfill(stage) : noBackfill
      ),
    World: () => Layer.mergeAll(worldTarget, noBackfill),
  });

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const args = yield* (yield* Stdio.Stdio).args;

      return yield* importExamples(args, layersOf);
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  );
}
