/**
 * debt: counts every escape directive the product's own code carries, by kind,
 * and fails when a count rises above `debt.baseline.json` or an escape has no
 * reason after ` -- ` (AGENTS.md principle 10). The count comes from
 * `fence/debt-ledger`, run alone through `oxlint.debt.config.ts`.
 *
 * `debt --lower` rewrites the baseline to the count, only ever downward.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Data, Effect, FileSystem, Path, Schema, Stdio } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import type { Change } from "./lib/debt.ts";
import {
  Baseline,
  judge,
  ledgerArgs,
  ledgerFromOxlintJson,
  lowered,
  renderBaseline,
  renderLowered,
  renderTable,
  renderVerdict,
  tally,
  Verdict,
} from "./lib/debt.ts";

const baselineFile = "debt.baseline.json";

class DebtRose extends Data.TaggedError("DebtRose")<{
  readonly rises: readonly Change[];
  readonly unreasoned: number;
}> {}

const main = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const args = yield* (yield* Stdio.Stdio).args;
  const lowering = args.includes("--lower");

  // oxlint exits 1 whenever it reports an escape, so only its report counts.
  const ledger = yield* spawner
    .string(
      ChildProcess.make(path.resolve("node_modules/.bin/oxlint"), ledgerArgs)
    )
    .pipe(Effect.flatMap(ledgerFromOxlintJson));

  const baseline = yield* fs
    .readFileString(baselineFile)
    .pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Baseline))));

  const verdict = judge(ledger, baseline);

  yield* Console.log(renderTable(tally(ledger), baseline));

  return yield* Verdict.$match(verdict, {
    Held: (held) =>
      Effect.gen(function* () {
        if (!lowering) {
          return yield* Console.log(renderVerdict(held));
        }

        if (held.falls.length === 0) {
          return yield* Console.log(
            "debt: every kind is at its baseline; nothing to lower."
          );
        }

        yield* fs.writeFileString(
          baselineFile,
          renderBaseline(lowered(held.tally, baseline))
        );

        return yield* Console.log(renderLowered(held.falls));
      }),
    Rose: (rose) =>
      Effect.gen(function* () {
        yield* Console.error(renderVerdict(rose));

        if (lowering) {
          yield* Console.error(
            `debt: not writing ${baselineFile}: --lower only lowers, and raising the baseline needs the user's sign-off (AGENTS.md principle 10).`
          );
        }

        return yield* new DebtRose({
          rises: rose.rises,
          unreasoned: rose.unreasoned.length,
        });
      }),
  });
});

BunRuntime.runMain(main.pipe(Effect.provide(BunServices.layer)));
