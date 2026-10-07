import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";

/**
 * A new temporary directory for a store's root, removed with its contents
 * when the test's scope closes.
 */
export const temporaryRoot = FileSystem.FileSystem.pipe(
  Effect.flatMap((fs) => fs.makeTempDirectoryScoped({ prefix: "repo-host-" })),
  Effect.orDie,
  Effect.provide(NodeServices.layer)
);
