/**
 * gen: writes every generated file from the one schema in `packages/protocol`
 * (AGENTS.md principle 4). `gen --check` writes nothing: it fails when any file
 * under the owned roots is stale, missing, or not gen's at all.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Data, Effect, FileSystem, Path, pipe, Stdio } from "effect";

import { drift, generate, ownedRoots } from "./lib/gen.ts";

class GeneratedFilesDrifted extends Data.TaggedError("GeneratedFilesDrifted")<{
  readonly stale: readonly string[];
  readonly missing: readonly string[];
  readonly extra: readonly string[];
}> {}

/** Every file now under the owned roots, with its content. */
const readOwned = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const listed = yield* pipe(
    ownedRoots,
    Effect.forEach((root) =>
      fs.exists(root).pipe(
        Effect.flatMap((exists) =>
          exists
            ? fs.readDirectory(root, { recursive: true })
            : Effect.succeed([])
        ),
        Effect.map((entries) => entries.map((entry) => path.join(root, entry)))
      )
    )
  );

  const files = yield* pipe(
    listed.flat(),
    Effect.filter((file) =>
      fs.stat(file).pipe(Effect.map((info) => info.type === "File"))
    )
  );

  return yield* pipe(
    files,
    Effect.forEach((file) =>
      fs
        .readFileString(file)
        .pipe(Effect.map((content) => ({ content, path: file })))
    )
  );
});

const check = Effect.gen(function* () {
  const expected = generate();
  const { extra, missing, stale } = drift(expected, yield* readOwned);

  if (extra.length + missing.length + stale.length === 0) {
    return yield* Console.log(`gen:check: ${expected.length} files, current`);
  }

  for (const [label, paths] of [
    ["stale", stale],
    ["missing", missing],
    ["not generated", extra],
  ] as const) {
    for (const path of paths) {
      yield* Console.error(`gen:check: ${label}: ${path}`);
    }
  }

  yield* Console.error("gen:check: run `bun run gen` and commit the result.");

  return yield* new GeneratedFilesDrifted({ extra, missing, stale });
});

const write = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const expected = generate();
  const { extra } = drift(expected, yield* readOwned);

  for (const file of expected) {
    yield* fs.makeDirectory(path.dirname(file.path), { recursive: true });
    yield* fs.writeFileString(file.path, file.content);
  }

  // The owned roots are gen's alone, so a file it would not write goes.
  for (const file of extra) {
    yield* fs.remove(file);
    yield* Console.log(`gen: removed ${file}`);
  }

  yield* Console.log(`gen: wrote ${expected.length} files`);
});

const main = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio;
  const args = yield* stdio.args;

  return yield* args.includes("--check") ? check : write;
});

BunRuntime.runMain(main.pipe(Effect.provide(BunServices.layer)));
