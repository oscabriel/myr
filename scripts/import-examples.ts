/**
 * `bun run import-examples`: imports the open-source repos the code browser
 * is previewed on, one at a time, onto a stage (never `demo`), recording
 * each in the ledger as kept. A stub until 913 builds it: it says so and
 * fails.
 */
import { BunRuntime } from "@effect/platform-bun";
import { Console, Effect } from "effect";

if (import.meta.main) {
  BunRuntime.runMain(
    Console.error("not built: 913").pipe(
      Effect.andThen(Effect.die("not built: 913"))
    ),
    { disableErrorReporting: true }
  );
}
