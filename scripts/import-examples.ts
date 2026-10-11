/**
 * `bun run import-examples`: imports the open-source repos the code browser
 * is previewed on (the eight that test its shapes, anyhow first, then
 * thirty well-known projects), one at a time, as the operator, onto a dev
 * stage or the Node world; never `demo`. Each new import is warmed: its
 * pages read once through the stage's web, so its first reader finds why
 * and its history kept; `--warm` warms the ones listed already too.
 *
 *   bun scripts/import-examples.ts --world node [--only anyhow]
 *   bunx varlock run --path apps/platform/ -- \
 *     bun scripts/import-examples.ts --stage dev-<user> --warm
 *   bunx varlock run --path apps/platform/ -- \
 *     bun scripts/import-examples.ts --stage dev-<user> [--only <p>] [--dry-run]
 *   bunx varlock run --path apps/platform/ -- bunx varlock run --path infra/ -- \
 *     bun scripts/import-examples.ts --stage dev-<user> --tags
 *
 * A project the platform lists already is skipped. After each import it
 * prints the repo's branch and tag counts (`git ls-remote`, anonymously).
 * Each new import on a stage is recorded in `infra/created.jsonl` with
 * `by: "import"` (its project and its repo): kept, never torn down.
 *
 * `--tags` backfills `refs/tags/*` for an import whose repo serves none:
 * the source's tags fetched into a temporary bare repo, then pushed to the
 * canonical repo with a write token minted over Artifacts' REST API for at
 * most ten minutes and revoked after, even on failure. It is the one write
 * that skips the gateway: tags only, by the operator, never `main`.
 *
 * `--sources` keeps the source of each earlier import on its record: the
 * same `initProject` asked again by the operator, which the platform
 * answers as the import did and takes as the source to keep (ADR 0031).
 * A project the ledger records as this stage's import is never imported
 * again, even when the platform does not list it. The core is `lib/import/`.
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

/** No backfill: the run was not asked for `--tags`, so nothing calls it. */
const noBackfill = Layer.succeed(
  TagBackfill,
  TagBackfill.of({
    backfill: () =>
      Effect.fail(new ImportExamplesFailed({ reason: "--tags was not given" })),
  })
);

/** The real target and backfill for what the flags ask. */
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
