/**
 * The fence-shaped example (issue 508; spec D21): `examples/burrow` is a Bun
 * project of its own, and these cases run its own commands in its folder, as
 * its maintainers would. Its lint reports exactly the six module-level `let`s
 * the ratchet starts from, one in each package's `src/`, as warnings; its
 * caller count finds `legacyFetch` in all six packages, in the JSON a migrate
 * ask's count command prints; and its lint rule's own fixture test passes.
 *
 * Each case installs first (`--frozen-lockfile`: burrow's devDependencies are
 * pinned to the root's, so Bun's cache serves them). The manifest's presence
 * is asserted before anything runs, so a missing project is a failed
 * assertion, not a spawn error.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { repoRoot } from "./root.ts";

const example = "examples/burrow";

/** The six workspace packages, each holding one module-level `let`. */
const PACKAGES = [
  "auth",
  "billing",
  "catalog",
  "kit",
  "notify",
  "search",
] as const;

/**
 * What a migrate ask's count command prints (issue 506's `CallerCount` in
 * `@repo/project/migrate`; `@repo/config` imports no workspace package, so
 * the shape is restated here).
 */
const CallerCount = Schema.Struct({
  byModule: Schema.Record(Schema.String, Schema.Int),
  total: Schema.Int,
});

/** The part of `oxlint --format json` these cases read. */
const OxlintReport = Schema.Struct({
  diagnostics: Schema.Array(
    Schema.Struct({
      code: Schema.optionalKey(Schema.String),
      filename: Schema.String,
      severity: Schema.String,
    })
  ),
});

/** A command's exit code and what it printed. */
interface Ran {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

/** Runs a command in burrow's folder and keeps its exit code and output. */
const run = (command: string, args: readonly string[]) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const cwd = path.join(yield* repoRoot, example);

    const handle = yield* spawner.spawn(
      ChildProcess.make(command, args, { cwd })
    );

    const [stdout, stderr, code] = yield* Effect.all(
      [
        Stream.mkString(Stream.decodeText(handle.stdout)),
        Stream.mkString(Stream.decodeText(handle.stderr)),
        handle.exitCode,
      ],
      { concurrency: "unbounded" }
    );

    return { code, stderr, stdout } satisfies Ran;
  }).pipe(Effect.scoped);

/** Asserts burrow exists, then installs its pinned devDependencies. */
const install = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const manifest = path.join(yield* repoRoot, example, "package.json");

    expect(
      yield* fs.exists(manifest),
      `${example}/package.json exists`
    ).toBeTruthy();

    // The whole run on a failure, so its stderr shows in the diff.
    expect(yield* run("bun", ["install", "--frozen-lockfile"])).toMatchObject({
      code: 0,
    });
  });

/** The package a reported file sits in, from its `packages/<name>/src/` path. */
const packageOf = (filename: string) =>
  /(?:^|\/)packages\/(?<name>[^/]+)\/src\//u.exec(filename)?.groups?.name;

/** Long enough for a cold install; a warm one takes about a second. */
const TIMEOUT = 180_000;

describe("examples/burrow", () => {
  it.live(
    "lints to exactly six module-level lets, one in each package's src/",
    () =>
      Effect.gen(function* () {
        yield* install();

        const lint = yield* run("bun", [
          "run",
          "lint",
          "--",
          "--format",
          "json",
        ]);

        const report = yield* Schema.decodeEffect(
          Schema.fromJsonString(OxlintReport)
        )(lint.stdout);

        expect(
          report.diagnostics
            .map(({ code, filename, severity }) => ({
              code,
              package: packageOf(filename) ?? filename,
              severity,
            }))
            .toSorted((one, other) => one.package.localeCompare(other.package))
        ).toStrictEqual(
          PACKAGES.map((name) => ({
            code: "burrow(no-module-level-mutable-state)",
            package: name,
            severity: "warning",
          }))
        );
        // Warnings while the ratchet counts them down: the lint itself, a
        // lane and a pre-commit hook, passes on main. At error it would fail
        // there, and every answer would wait on a red main.
        expect(lint).toMatchObject({ code: 0 });
      }).pipe(Effect.provide(NodeServices.layer)),
    TIMEOUT
  );

  it.live(
    "counts legacyFetch's callers in every package, as a migrate ask's count command",
    () =>
      Effect.gen(function* () {
        yield* install();

        const count = yield* run("bun", [
          "scripts/count-callers.ts",
          "legacyFetch",
          "--json",
        ]);

        expect(count).toMatchObject({ code: 0 });

        const counts = yield* Schema.decodeEffect(
          Schema.fromJsonString(CallerCount)
        )(count.stdout);

        expect(Object.keys(counts.byModule).toSorted()).toStrictEqual(
          PACKAGES.map((name) => `@burrow/${name}`)
        );

        // No package is left out of the family: each has a caller.
        expect(
          Object.entries(counts.byModule).filter(([, callers]) => callers < 1)
        ).toStrictEqual([]);

        expect(counts.total).toBe(
          Object.values(counts.byModule).reduce((sum, n) => sum + n, 0)
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    TIMEOUT
  );

  it.live(
    "passes its lint rule's own fixture test",
    () =>
      Effect.gen(function* () {
        yield* install();

        const rules = yield* run("bun", ["run", "lint:rules"]);

        expect(rules).toMatchObject({ code: 0 });
      }).pipe(Effect.provide(NodeServices.layer)),
    TIMEOUT
  );
});
