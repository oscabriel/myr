/**
 * The recorded linter output the kinds' tests read: stdout byte for byte,
 * from `test/fixtures/lint/<name>.stdout`. `lint-count.test.ts` describes
 * the fixture repo and the commands that printed each one.
 */
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";

/** One recording's stdout, by its name without `.stdout`. */
export const recorded = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return yield* fs.readFileString(
      `${import.meta.dirname}/../fixtures/lint/${name}.stdout`
    );
  }).pipe(Effect.orDie, Effect.provide(NodeServices.layer));
