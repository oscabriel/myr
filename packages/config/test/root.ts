import { Effect, FileSystem, Option, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** The repo root. Vitest runs in the package's folder, two below it. */
export const repoRoot = Effect.map(Path.Path, (path) =>
  path.resolve("..", "..")
);

/**
 * Every file git tracks or would track (ignored files left out), from the
 * repo root. A tracked file deleted but not yet staged is still listed:
 * `textOf` reads it as none.
 */
export const committable = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const cwd = yield* repoRoot;

  const handle = yield* spawner.spawn(
    ChildProcess.make(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd }
    )
  );

  const [listed, code] = yield* Effect.all(
    [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
    { concurrency: "unbounded" }
  );

  if (code !== 0) {
    return yield* Effect.die(`git ls-files exited with ${code}`);
  }

  return listed.split("\n").filter((line) => line.length > 0);
}).pipe(Effect.scoped);

/** A file under the repo root, as text, if it is on disk. */
export const textOf = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const at = path.join(yield* repoRoot, file);

    return (yield* fs.exists(at))
      ? Option.some(yield* fs.readFileString(at))
      : Option.none<string>();
  });
