/**
 * imports:check: fails when an import crosses a line the workspace graph
 * forbids (AGENTS.md principle 6). Files come from git, so ignored files are
 * never opened.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Data, Effect, FileSystem, pipe, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { findViolations } from "./lib/imports.ts";
import type { Workspace } from "./lib/imports.ts";

class ImportsCrossed extends Data.TaggedError("ImportsCrossed")<{
  readonly count: number;
}> {}

const RootPackage = Schema.Struct({
  workspaces: Schema.Struct({ packages: Schema.Array(Schema.String) }),
});

const Dependencies = Schema.optionalKey(
  Schema.Record(Schema.String, Schema.String)
);

const WorkspacePackage = Schema.Struct({
  dependencies: Dependencies,
  devDependencies: Dependencies,
  name: Schema.String,
});

const SOURCE = /\.(?:ts|tsx|mts|cts)$/u;

/** `apps/*` as a test of a folder path: `*` is one path segment. */
const matchesGlob = (glob: string) => {
  const parts = glob.split("/");

  return (dir: string) => {
    const segments = dir.split("/");

    return (
      segments.length === parts.length &&
      parts.every((part, index) => part === "*" || part === segments[index])
    );
  };
};

const listCommittable = Effect.gen(function* () {
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

const readJson = <S extends Schema.Top>(file: string, schema: S) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs
      .readFileString(file)
      .pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(schema))))
  );

const check = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* listCommittable;
  const root = yield* readJson("package.json", RootPackage);
  const globs = root.workspaces.packages.map(matchesGlob);

  const manifests = paths.filter((path) => {
    const dir = path.slice(0, -"/package.json".length);

    return (
      path.endsWith("/package.json") && globs.some((matches) => matches(dir))
    );
  });

  const workspaces: readonly Workspace[] = yield* pipe(
    manifests,
    Effect.forEach((manifest) =>
      readJson(manifest, WorkspacePackage).pipe(
        Effect.map((pkg) => ({
          dependencies: Object.keys({
            ...pkg.dependencies,
            ...pkg.devDependencies,
          }).toSorted(),
          dir: manifest.slice(0, -"/package.json".length),
          name: pkg.name,
        }))
      )
    )
  );

  const files = yield* pipe(
    paths.filter((path) => SOURCE.test(path)),
    Effect.forEach((path) =>
      fs.exists(path).pipe(
        Effect.flatMap((exists) =>
          exists ? fs.readFileString(path) : Effect.succeed("")
        ),
        Effect.map((content) => ({ content, path }))
      )
    )
  );

  const violations = findViolations(files, workspaces);

  if (violations.length === 0) {
    return yield* Console.log(
      `imports:check: ${files.length} files, ${workspaces.length} workspaces, no violations`
    );
  }

  for (const violation of violations) {
    yield* Console.error(
      `${violation.path}:${violation.line}: ${violation.rule}: ${violation.specifier}`
    );
  }

  yield* Console.error(
    "imports:check: apps import packages only; move what both need into a package."
  );

  return yield* new ImportsCrossed({ count: violations.length });
});

BunRuntime.runMain(check.pipe(Effect.provide(BunServices.layer)));
