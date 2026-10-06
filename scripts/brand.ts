/**
 * brand:check: fails when any file git would commit spells the product's name
 * outside `packages/brand` and prose. Files come from git, so ignored files
 * (the closed `.env*` values among them) are never opened.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { findLeaks } from "@repo/brand/leaks";
import { Console, Data, Effect, FileSystem, pipe } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

class BrandLeaks extends Data.TaggedError("BrandLeaks")<{
  readonly count: number;
}> {}

const listCommittable = Effect.gen(function* listCommittable() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const lines = yield* spawner.lines(
    ChildProcess.make("git", [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--deduplicate",
    ])
  );

  return lines.filter((line) => line.length > 0);
});

const check = Effect.gen(function* check() {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* listCommittable;

  const files = yield* pipe(
    paths,
    Effect.forEach((path) =>
      fs.exists(path).pipe(
        Effect.flatMap((exists) =>
          exists ? fs.readFileString(path) : Effect.succeed("")
        ),
        Effect.map((content) => ({ content, path }))
      )
    )
  );

  const leaks = findLeaks(files);

  if (leaks.length === 0) {
    return yield* Console.log(`brand:check: ${files.length} files, no leaks`);
  }

  for (const leak of leaks) {
    yield* Console.error(`${leak.path}:${leak.line}: ${leak.text}`);
  }

  yield* Console.error(
    "brand:check: take the name from @repo/brand instead of spelling it."
  );

  return yield* new BrandLeaks({ count: leaks.length });
});

BunRuntime.runMain(check.pipe(Effect.provide(BunServices.layer)));
