/**
 * `bun run build`: the CLI as it ships, in `dist/`.
 *
 * 1. tsdown (`tsdown.config.ts`) writes the npm build: `bin.js`, `rules.js`
 *    and `protocol.js`, every workspace package inlined.
 * 2. tsgo declares the two library entries, workspace packages included,
 *    and tsdown bundles that into `rules.d.ts` and `protocol.d.ts`.
 * 3. `bun build --compile` makes the standalone binary `bin/<cli>` for this
 *    machine, or `bin/<target>/<cli>` for each of `--targets`.
 * 4. Beside each binary, `git-credential-<slug>` links to it: the binary
 *    sees the name it was started by (`src/bin.ts`), so the link is git's
 *    credential helper.
 *
 * A Bun script, outside every Worker's graph. Names come from `Brand`.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Brand } from "@repo/brand";
import {
  Data,
  Effect,
  FileSystem,
  Option,
  Path,
  Predicate,
  Schema,
} from "effect";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { build } from "tsdown";

import { declarations, library } from "./tsdown.config.ts";

class BuildFailed extends Data.TaggedError("BuildFailed")<{
  readonly step: string;
  readonly detail: string;
}> {}

/** A tsconfig the build writes for one step. */
interface Tsconfig {
  readonly compilerOptions: {
    readonly declaration?: boolean;
    readonly emitDeclarationOnly?: boolean;
    readonly noCheck?: boolean;
    readonly noEmit?: boolean;
    readonly outDir?: string;
    /** Module names onto files: each workspace package's exports. */
    readonly paths: Readonly<Record<string, readonly string[]>>;
    readonly rootDir?: string;
  };
  readonly extends?: string;
  readonly files: readonly string[];
  readonly include?: readonly string[];
}

/** What the build reads of a workspace package's manifest. */
const Manifest = Schema.fromJsonString(
  Schema.Struct({
    exports: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    name: Schema.String,
  })
);

/** Runs `command` with this terminal's output; any exit but 0 fails `step`. */
const run = (step: string, command: string, args: readonly string[]) =>
  Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
    spawner.exitCode(
      ChildProcess.make(command, args, {
        stderr: "inherit",
        stdin: "ignore",
        stdout: "inherit",
      })
    )
  ).pipe(
    Effect.mapError(
      (failure) => new BuildFailed({ detail: failure.message, step })
    ),
    Effect.filterOrFail(
      (exitCode) => exitCode === 0,
      (exitCode) => new BuildFailed({ detail: `exit code ${exitCode}`, step })
    ),
    Effect.asVoid
  );

/** tsdown over `config`, as one build step. */
const tsdown = (step: string, config: Parameters<typeof build>[0]) =>
  Effect.tryPromise({
    catch: (cause) => new BuildFailed({ detail: String(cause), step }),
    try: () => build(config),
  });

const make = (targets: readonly string[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* path.fromFileUrl(new URL(".", import.meta.url));
    const repo = path.join(root, "..", "..");
    const dist = path.join(root, "dist");

    /**
     * `paths` that map every workspace package's exports, as its manifest
     * states them, onto `onto(file)` for each file they name.
     */
    const workspacePaths = (onto: (file: string) => string) =>
      Effect.gen(function* () {
        const packages = path.join(repo, "packages");
        const paths: Record<string, readonly string[]> = {};

        for (const folder of yield* fs.readDirectory(packages)) {
          const manifest = path.join(packages, folder, "package.json");

          if (yield* fs.exists(manifest)) {
            const { exports = {}, name } = yield* fs
              .readFileString(manifest)
              .pipe(Effect.flatMap(Schema.decodeEffect(Manifest)));

            for (const [subpath, file] of Object.entries(exports)) {
              if (Predicate.isString(file)) {
                paths[`${name}${subpath.slice(1)}`] = [
                  onto(path.join(packages, folder, file)),
                ];
              }
            }
          }
        }

        return paths;
      });

    /** Writes `config` as a tsconfig in `dir`, and gives its path. */
    const tsconfigIn = (dir: string, name: string, config: Tsconfig) =>
      Effect.as(
        fs.writeFileString(path.join(dir, name), JSON.stringify(config)),
        path.join(dir, name)
      );

    // 1. The npm build.
    yield* tsdown("tsdown", {
      config: path.join(root, "tsdown.config.ts"),
      cwd: root,
    });

    // 2. The library entries' types.
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "cli-types-" });
    const declared = path.join(scratch, "declared");

    /** Where tsgo declares `file` (a source under the repo). */
    const declaration = (file: string) =>
      path.join(declared, path.relative(repo, file)).replace(/\.ts$/u, ".d.ts");

    const emit = yield* tsconfigIn(scratch, "emit.json", {
      compilerOptions: {
        declaration: true,
        emitDeclarationOnly: true,
        // Typecheck has checked these sources; this only declares them.
        noCheck: true,
        noEmit: false,
        outDir: declared,
        paths: yield* workspacePaths((file) => file),
        rootDir: repo,
      },
      extends: path.join(root, "tsconfig.json"),
      files: Object.values(library).map((entry) => path.join(root, entry)),
      include: [],
    });

    yield* run("tsgo", "bun", [
      path.join(root, "node_modules", "typescript", "bin", "tsc"),
      "--project",
      emit,
    ]);

    const types = yield* tsconfigIn(scratch, "types.json", {
      compilerOptions: { paths: yield* workspacePaths(declaration) },
      files: [],
    });

    yield* tsdown("declarations", {
      ...declarations(
        {
          protocol: declaration(path.join(root, library.protocol)),
          rules: declaration(path.join(root, library.rules)),
        },
        types
      ),
      config: false,
      cwd: root,
    });

    // 3 and 4. The binaries, each with its credential helper link.
    const outputs =
      targets.length === 0
        ? [{ dir: path.join(dist, "bin"), target: Option.none<string>() }]
        : targets.map((target) => ({
            dir: path.join(dist, "bin", target),
            target: Option.some(target),
          }));

    for (const { dir, target } of outputs) {
      yield* run("bun build --compile", "bun", [
        "build",
        "--compile",
        "--minify",
        ...Option.match(target, {
          onNone: () => [],
          onSome: (name) => [`--target=bun-${name}`],
        }),
        path.join(root, "src", "bin.ts"),
        "--outfile",
        path.join(dir, Brand.cli),
      ]);

      yield* fs.symlink(Brand.cli, path.join(dir, Brand.gitCredentialHelper));
    }
  }).pipe(Effect.scoped);

const targets = Flag.String("targets").pipe(
  Flag.withDescription(
    "Cross-compile for these Bun targets, comma-separated (linux-x64,darwin-arm64); each binary goes to dist/bin/<target>/."
  ),
  Flag.optional
);

const command = Command.make("build", { targets }, (flags) =>
  make(
    Option.match(flags.targets, {
      onNone: () => [],
      onSome: (list) =>
        list
          .split(",")
          .map((target) => target.trim().replace(/^bun-/u, ""))
          .filter((target) => target.length > 0),
    })
  )
).pipe(
  Command.withDescription(
    "Build the CLI: the npm dist/, and a standalone binary that is also git's credential helper."
  )
);

BunRuntime.runMain(
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(BunServices.layer)
  )
);
