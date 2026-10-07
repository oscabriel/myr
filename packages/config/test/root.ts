import { Effect, Path } from "effect";

/** The repo root. Vitest runs in the package's folder, two below it. */
export const repoRoot = Effect.map(Path.Path, (path) =>
  path.resolve("..", "..")
);
