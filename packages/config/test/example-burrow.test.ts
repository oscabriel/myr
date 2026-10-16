// Each case installs first (`--frozen-lockfile`: burrow's devDependencies are
// pinned to the root's, so Bun's cache serves them).
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { repoRoot } from "./root.ts";

const example = "examples/burrow";

const PACKAGES = [
  "auth",
  "billing",
  "catalog",
  "kit",
  "notify",
  "search",
] as const;

/** `@repo/config` imports no workspace package, so `CallerCount`'s shape is restated here. */
const CallerCount = Schema.Struct({
  byModule: Schema.Record(Schema.String, Schema.Int),
  total: Schema.Int,
});

const OxlintReport = Schema.Struct({
  diagnostics: Schema.Array(
    Schema.Struct({
      code: Schema.optionalKey(Schema.String),
      filename: Schema.String,
      severity: Schema.String,
    })
  ),
});

interface Ran {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

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

const install = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const manifest = path.join(yield* repoRoot, example, "package.json");

    expect(
      yield* fs.exists(manifest),
      `${example}/package.json exists`
    ).toBeTruthy();

    expect(yield* run("bun", ["install", "--frozen-lockfile"])).toMatchObject({
      code: 0,
    });
  });

/** Only each package's resolved id (`name@version`, or `name@workspace:path`) is read. */
const BunLock = Schema.Struct({
  packages: Schema.Record(
    Schema.String,
    Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Unknown])
  ),
});

/** A Bun lockfile is JSON with trailing commas. */
const pinnedIn = (lockfile: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const text = yield* fs.readFileString(path.join(yield* repoRoot, lockfile));

    const lock = yield* Schema.decodeEffect(Schema.fromJsonString(BunLock))(
      text.replaceAll(/,(?=\s*[\]}])/gu, "")
    );

    return Object.values(lock.packages)
      .map(([id]) => id)
      .filter((id) => !id.includes("@workspace:"));
  });

const packageOf = (filename: string) =>
  /(?:^|\/)packages\/(?<name>[^/]+)\/src\//u.exec(filename)?.groups?.name;

const TIMEOUT = 180_000;

describe("examples/burrow", () => {
  // A Checker's setup installs the root's packages with the network on, and
  // its lanes run these cases with it off: a package only burrow pins is a
  // failed install in every lane, which a cache an earlier setup kept hides.
  it.effect(
    "pins only packages the root's lockfile pins, so its install needs no network",
    () =>
      Effect.gen(function* () {
        const root = new Set(yield* pinnedIn("bun.lock"));
        const burrow = yield* pinnedIn(`${example}/bun.lock`);

        expect(burrow.length).toBeGreaterThan(0);
        expect(burrow.filter((id) => !root.has(id))).toStrictEqual([]);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.live(
    "lints to exactly six module-level lets, one in each package's src/",
    () =>
      Effect.gen(function* () {
        yield* install();

        const lint = yield* run("bun", ["run", "lint", "--format", "json"]);

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

        expect(counts).toStrictEqual({
          byModule: {
            "@burrow/auth": 2,
            "@burrow/billing": 2,
            "@burrow/catalog": 2,
            "@burrow/kit": 1,
            "@burrow/notify": 1,
            "@burrow/search": 1,
          },
          total: 9,
        });
      }).pipe(Effect.provide(NodeServices.layer)),
    TIMEOUT
  );

  it.live(
    "passes its other lanes on main, the typecheck and the tests its hooks run",
    () =>
      Effect.gen(function* () {
        yield* install();

        // A lane red on main blocks every answer (VerifierBlocked), so both
        // hold here, by the commands the finder reads from lefthook.yml.
        expect(yield* run("bun", ["run", "typecheck"])).toMatchObject({
          code: 0,
        });
        expect(yield* run("bun", ["test"])).toMatchObject({ code: 0 });
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
