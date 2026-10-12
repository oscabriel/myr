import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";

import { repoRoot } from "./root.ts";

const RootPackage = Schema.Struct({
  scripts: Schema.Record(Schema.String, Schema.String),
});

const rootScripts = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* repoRoot;
  const text = yield* fs.readFileString(path.join(root, "package.json"));

  return (yield* Schema.decodeEffect(Schema.fromJsonString(RootPackage))(text))
    .scripts;
});

describe("verify", () => {
  it.live("runs the product's checks, in order", () =>
    Effect.gen(function* () {
      const scripts = yield* rootScripts;

      expect(
        (scripts.verify ?? "")
          .split(" && ")
          .map((step) => step.replace("bun run ", ""))
      ).toStrictEqual([
        "lockfile:check",
        "check",
        "typecheck",
        "test",
        "brand:check",
        "bytes:check",
      ]);
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live("names only scripts the root has", () =>
    Effect.gen(function* () {
      const scripts = yield* rootScripts;

      expect(
        (scripts.verify ?? "")
          .split(" && ")
          .map((step) => step.replace("bun run ", ""))
          .filter((step) => scripts[step] === undefined)
      ).toStrictEqual([]);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
