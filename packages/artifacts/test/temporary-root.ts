import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";

export const temporaryRoot = FileSystem.FileSystem.pipe(
  Effect.flatMap((fs) => fs.makeTempDirectoryScoped({ prefix: "repo-host-" })),
  Effect.orDie,
  Effect.provide(NodeServices.layer)
);
