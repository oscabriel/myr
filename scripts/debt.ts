/**
 * debt: counts every escape directive the product's own code carries, by kind,
 * and fails when a count rises above `debt.baseline.json` (AGENTS.md principle
 * 10). The count comes from `fence/debt-ledger`, run alone through
 * `oxlint.debt.config.ts`.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Data, Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  Kind,
  ledgerArgs,
  ledgerFromOxlintJson,
  rises,
  tally,
  Tally,
} from "./lib/debt.ts";

class DebtRose extends Data.TaggedError("DebtRose")<{
  readonly kinds: readonly Kind[];
}> {}

const check = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  // oxlint exits 1 whenever it reports an escape, so only its report counts.
  const report = yield* spawner.string(
    ChildProcess.make(path.resolve("node_modules/.bin/oxlint"), ledgerArgs)
  );

  const counted = tally(yield* ledgerFromOxlintJson(report));

  const baseline = yield* fs
    .readFileString("debt.baseline.json")
    .pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Tally))));

  const risen = rises(counted, baseline);

  for (const kind of Kind.literals) {
    yield* Console.log(`debt: ${kind}: ${counted[kind]} of ${baseline[kind]}`);
  }

  if (risen.length === 0) {
    return yield* Console.log("debt: no kind rose above its baseline");
  }

  for (const rise of risen) {
    yield* Console.error(
      `debt: ${rise.kind} rose to ${rise.count}, above its baseline of ${rise.baseline}.`
    );
  }

  yield* Console.error(
    "debt: remove the new escape, or fix what it hides. Raising debt.baseline.json takes the user's sign-off."
  );

  return yield* new DebtRose({ kinds: risen.map((rise) => rise.kind) });
});

BunRuntime.runMain(check.pipe(Effect.provide(BunServices.layer)));
