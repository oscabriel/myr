import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";

export const recorded = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return yield* fs.readFileString(
      `${import.meta.dirname}/../fixtures/lint/${name}.stdout`
    );
  }).pipe(Effect.orDie, Effect.provide(NodeServices.layer));
