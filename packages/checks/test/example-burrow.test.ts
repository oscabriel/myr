import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { gitOk } from "@repo/testkit/git";
import { Effect, FileSystem, Path } from "effect";

import { findRunBlock } from "../src/finder.ts";
import type { RepoFile } from "../src/finder.ts";

const burrowFiles = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // Vitest runs in the package's folder, two below the repo's root.
    const root = path.resolve("..", "..", "examples", "burrow");

    const tracked = (yield* gitOk(root, "ls-files", "-z"))
      .split("\0")
      .filter((name) => name !== "");

    expect(tracked, "examples/burrow tracks its manifest").toContain(
      "package.json"
    );

    return yield* Effect.forEach(tracked, (name) =>
      Effect.map(
        fs.readFileString(path.join(root, name)),
        (content): RepoFile => ({ content, path: name })
      )
    );
  });

describe("the finder over examples/burrow", () => {
  it.live(
    "finds the lint, types and unit lanes its hooks run, setup from its lockfile, and one test file's command",
    () =>
      Effect.gen(function* () {
        expect(findRunBlock(yield* burrowFiles())).toStrictEqual({
          run: {
            checks: {
              lint: "bun run lint",
              types: "bun run typecheck",
              unit: "bun test",
            },
            setup: "bun install --frozen-lockfile",
            test: "bun test {path}",
          },
          sources: [
            "setup inferred from bun.lock",
            "test from lefthook.yml",
            "checks.lint from lefthook.yml",
            "checks.types from lefthook.yml",
            "checks.unit from lefthook.yml",
          ],
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
