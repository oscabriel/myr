/**
 * imports:check: fails when an import crosses a line AGENTS.md principle 6
 * draws: the package direction, the Worker host rules, adapters through their
 * own subpaths, test-only and infra-only imports. Files come from git, so
 * ignored files are never opened. The rules live in `lib/imports.ts`.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Data, Effect, FileSystem, pipe, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { findViolations, formatViolation, RuleHints } from "./lib/imports.ts";
import type { Workspace } from "./lib/imports.ts";

class ImportsCrossed extends Data.TaggedError("ImportsCrossed")<{
  readonly count: number;
}> {}

const Dependencies = Schema.optionalKey(
  Schema.Record(Schema.String, Schema.String)
);

/** An `exports` target: a path, or a path per condition. */
const Target = Schema.Union([
  Schema.String,
  Schema.Record(Schema.String, Schema.String),
]);

const Manifest = Schema.Struct({
  dependencies: Dependencies,
  devDependencies: Dependencies,
  exports: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Record(Schema.String, Target)])
  ),
  name: Schema.String,
});

const RootManifest = Schema.Struct({
  ...Manifest.fields,
  workspaces: Schema.Struct({ packages: Schema.Array(Schema.String) }),
});

const SOURCE = /\.(?:ts|tsx|mts|cts)$/u;

/** Vendored, fixture, example and generated code: not ours to direct. */
const SKIPPED = [
  "tools/oxlint/anti-slop/",
  "tools/oxlint/fence/fixtures/",
  "examples/",
  ".agent_sources/",
];

const GENERATED = /(?:^|\/)worker-configuration\.d\.ts$/u;

const isChecked = (path: string) =>
  SOURCE.test(path) &&
  !GENERATED.test(path) &&
  !SKIPPED.some((prefix) => path.startsWith(prefix));

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

/** Each subpath's files, with conditions flattened. */
const exportsOf = (exports: (typeof Manifest.Type)["exports"]) => {
  if (exports === undefined) {
    return {};
  }

  if (Schema.is(Schema.String)(exports)) {
    return { ".": [exports] };
  }

  return Object.fromEntries(
    Object.entries(exports).map(([subpath, target]) => [
      subpath,
      Schema.is(Schema.String)(target) ? [target] : Object.values(target),
    ])
  );
};

const workspaceOf = (
  dir: string,
  manifest: typeof Manifest.Type
): Workspace => ({
  dependencies: Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  }).toSorted(),
  dir,
  exports: exportsOf(manifest.exports),
  name: manifest.name,
});

const check = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* listCommittable;
  const root = yield* readJson("package.json", RootManifest);
  const globs = root.workspaces.packages.map(matchesGlob);

  const manifests = paths.filter((path) => {
    const dir = path.slice(0, -"/package.json".length);

    return (
      path.endsWith("/package.json") && globs.some((matches) => matches(dir))
    );
  });

  const members = yield* pipe(
    manifests,
    Effect.forEach((manifest) =>
      readJson(manifest, Manifest).pipe(
        Effect.map((decoded) =>
          workspaceOf(manifest.slice(0, -"/package.json".length), decoded)
        )
      )
    )
  );

  // The root's own files (`scripts/`, `infra/`) belong to the root workspace.
  const workspaces = [workspaceOf("", root), ...members];

  const files = yield* pipe(
    paths.filter(isChecked),
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
    yield* Console.error(formatViolation(violation));
  }

  const broken = [...new Set(violations.map((violation) => violation.rule))];

  for (const rule of broken) {
    yield* Console.error(`imports:check: ${rule}: ${RuleHints[rule]}`);
  }

  return yield* new ImportsCrossed({ count: violations.length });
});

BunRuntime.runMain(check.pipe(Effect.provide(BunServices.layer)));
