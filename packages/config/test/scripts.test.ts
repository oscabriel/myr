/**
 * The demo-readiness scripts: a maintainer types `bun run swarm`,
 * `bun run seed` or `bun run release`, and each runs one entry file that
 * exists, so the work that builds them fills an entry without touching a
 * root file.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";

import { repoRoot } from "./root.ts";

const RootPackage = Schema.Struct({
  scripts: Schema.Record(Schema.String, Schema.String),
});

/** What `bun run <name>` runs, and whether its entry file is on disk. */
const entryOf = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* repoRoot;
    const text = yield* fs.readFileString(path.join(root, "package.json"));

    const { scripts } = yield* Schema.decodeEffect(
      Schema.fromJsonString(RootPackage)
    )(text);

    const command = scripts[name] ?? "";
    const file = /^bun (?<file>\S+)$/u.exec(command)?.groups?.file;

    return {
      command,
      exists:
        file === undefined ? false : yield* fs.exists(path.join(root, file)),
    };
  });

describe("the demo-readiness scripts", () => {
  it.live("swarm, seed and release each run one entry file that exists", () =>
    Effect.gen(function* () {
      expect({
        release: yield* entryOf("release"),
        seed: yield* entryOf("seed"),
        swarm: yield* entryOf("swarm"),
      }).toStrictEqual({
        release: { command: "bun scripts/release.ts", exists: true },
        seed: { command: "bun scripts/seed.ts", exists: true },
        swarm: { command: "bun scripts/swarm.ts", exists: true },
      });
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
