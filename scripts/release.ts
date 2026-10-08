/**
 * release: builds the CLI into a publishable package and two single-file
 * binaries, which the platform serves from its own bucket (issue 715). Only a
 * person publishes.
 *
 * A stub until 715 builds it: it says so in one line and exits 1.
 */
import { BunRuntime } from "@effect/platform-bun";
import { Console, Effect, Runtime, Schema } from "effect";

/** The script is not built yet: the line it printed says where it will be. */
class NotBuilt extends Schema.TaggedError<NotBuilt>()("NotBuilt", {}) {
  override readonly [Runtime.errorExitCode] = 1;
  override readonly [Runtime.errorReported] = false;
}

const main = Effect.gen(function* () {
  yield* Console.error("not built: see .scratch/build/issues/715-release.md");

  return yield* new NotBuilt();
});

BunRuntime.runMain(main);
