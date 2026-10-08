/**
 * The command finder over the fence-shaped example:
 * `examples/burrow`'s tracked files, read as `init` reads a repo's, give the
 * run block burrow's config folder states. Its lanes come from the hooks in
 * `lefthook.yml`, which run its `package.json` scripts; its setup from its
 * lockfile; and one test file's command from its pre-push `bun test`.
 *
 * The finder is pure, so the case only reads files. That burrow's manifest
 * is among them is asserted first, so a missing example is a failed
 * assertion, not an empty run block.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { gitOk } from "@repo/testkit/git";
import { Effect, FileSystem, Path } from "effect";

import { findRunBlock } from "../src/finder.ts";
import type { RepoFile } from "../src/finder.ts";

/** burrow's tracked files, by their paths from its own root. */
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
