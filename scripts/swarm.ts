/**
 * swarm: six fictional contributors, on four harnesses, each answer one child
 * of a project's split family on a stage (issue 702 plans them, 711 runs them).
 *
 * A stub until 702 builds it: it says so in one line and exits 1.
 */
import { BunRuntime } from "@effect/platform-bun";
import { Console, Effect, Runtime, Schema } from "effect";

/** The script is not built yet: the line it printed says where it will be. */
class NotBuilt extends Schema.TaggedError<NotBuilt>()("NotBuilt", {}) {
  override readonly [Runtime.errorExitCode] = 1;
  override readonly [Runtime.errorReported] = false;
}

const main = Effect.gen(function* () {
  yield* Console.error(
    "not built: see .scratch/build/issues/702-swarm-plan.md"
  );

  return yield* new NotBuilt();
});

BunRuntime.runMain(main);
