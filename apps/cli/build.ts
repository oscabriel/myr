/**
 * `bun run build`: the CLI as it ships, in `dist/`.
 *
 * 1. tsdown (`tsdown.config.ts`) writes the npm build: `bin.js`, `rules.js`
 *    and `protocol.js`, every workspace package inlined.
 * 2. tsgo declares the two library entries, workspace packages included,
 *    and tsdown bundles that into `rules.d.ts` and `protocol.d.ts`.
 * 3. `bun build --compile` makes the standalone binary `bin/<cli>` for this
 *    machine, or `bin/<target>/<cli>` for each of `--targets`. It embeds the
 *    sdk and the rules' entry, each bundled whole, and hands their embedded
 *    paths to `src/local/config-runtime.ts` before the CLI starts, so the
 *    binary alone can bundle and evaluate a TypeScript config folder. For
 *    each of `--targets`, the target's native packages (`build-targets.ts`)
 *    are fetched from npm into a temp folder the compile resolves through
 *    `NODE_PATH`: `bun install` left out every other machine's.
 * 4. Beside each binary, `git-credential-<slug>` links to it: the binary
 *    sees the name it was started by (`src/bin.ts`), so the link is git's
 *    credential helper.
 *
 * `--version <semver>` stamps both builds (`versionDefine`): it is what
 * the CLI's `--version` prints. Without it the build says `0.0.0`.
 *
 * A Bun script, outside every Worker's graph. Names come from `Brand`.
 * Importing it builds nothing (`tsdown.config.ts` and the tests read its
 * pure parts): only `bun build.ts` runs the build.
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
  Stdio,
} from "effect";
import { CliConfig, Command, Flag, GlobalFlag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { build } from "tsdown";

import { NATIVE, npmMachineOf } from "./build-targets.ts";
import { EMBEDDED_KEY } from "./src/local/config-runtime.ts";
import {
  declarations,
  library,
  npm,
  UNSTAMPED,
  versionDefine,
} from "./tsdown.config.ts";

// The one define both bundlers get, kept beside tsdown's configs, which
// this module imports (lint refuses an import cycle).
export { versionDefine } from "./tsdown.config.ts";

/** What one build is asked for. */
export interface BuildOptions {
  /** Bun targets to cross-compile for, without `bun-`; none builds for this machine. */
  readonly targets: readonly string[];
  /** The version both builds are stamped with. */
  readonly version: string;
}

/**
 * `bun build --compile`'s arguments for one binary: `entry` compiled to
 * `outfile`, for `target` (this machine when absent), stamped with `version`.
 */
export const compileArgs = (input: {
  readonly entry: string;
  readonly outfile: string;
  readonly target?: string;
  readonly version: string;
}) => [
  "build",
  "--compile",
  "--minify",
  ...Object.entries(versionDefine(input.version)).flatMap(([key, value]) => [
    "--define",
    `${key}=${value}`,
  ]),
  ...(input.target === undefined ? [] : [`--target=bun-${input.target}`]),
  input.entry,
  "--outfile",
  input.outfile,
];

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

/** What the build reads of a native package's manifest: its machines' packages. */
const NativeManifest = Schema.fromJsonString(
  Schema.Struct({
    optionalDependencies: Schema.Record(Schema.String, Schema.String),
  })
);

/** What the build reads of a workspace package's manifest. */
const Manifest = Schema.fromJsonString(
  Schema.Struct({
    exports: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    name: Schema.String,
  })
);

/**
 * Runs `command` with this terminal's output, in `cwd` and with `env` over
 * this process's own when given; any exit but 0 fails `step`.
 */
const run = (
  step: string,
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
  } = {}
) =>
  Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
    spawner.exitCode(
      ChildProcess.make(command, args, {
        cwd: options.cwd,
        env: { ...options.env },
        extendEnv: true,
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

const make = ({ targets, version }: BuildOptions) =>
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

    // 1. The npm build, one entry at a time: the first cleans `dist/`.
    for (const config of npm(version)) {
      yield* tsdown(`tsdown ${Object.keys(config.entry).join(", ")}`, {
        ...config,
        config: false,
        cwd: root,
      });
    }

    // 2. The library entries' types. tsgo declares them in a folder at a
    // fixed path, removed once the build ends: the bundled `.d.ts` files keep
    // each source's path in a comment, so a temp folder's random name would
    // make every build's types differ (and publish this machine's paths).
    const scratch = path.join(dist, ".types");

    yield* Effect.acquireRelease(
      fs.makeDirectory(scratch, { recursive: true }),
      () => Effect.orDie(fs.remove(scratch, { recursive: true }))
    );

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

    // 3. What the binary embeds for a TypeScript config folder: the sdk and
    // the rules' entry, each one file with effect inlined (a machine with
    // only the binary has no node_modules), and the entry `bun build
    // --compile` starts from, which hands their embedded paths over before
    // `src/bin.ts` runs (a module's imports run in order).
    const compile = path.join(dist, ".compile");

    yield* Effect.acquireRelease(
      fs.makeDirectory(compile, { recursive: true }),
      () => Effect.orDie(fs.remove(compile, { recursive: true }))
    );

    for (const [name, source] of [
      ["sdk.js", path.join(repo, "packages", "sdk", "src", "index.ts")],
      ["entry.js", path.join(repo, "packages", "rules", "src", "entry.ts")],
    ] as const) {
      yield* run(`bundle ${name}`, "bun", [
        "build",
        "--no-macros",
        "--target=browser",
        "--format=esm",
        source,
        "--outfile",
        path.join(compile, name),
      ]);
    }

    yield* fs.writeFileString(
      path.join(compile, "runtime.ts"),
      [
        'import entry from "./entry.js" with { type: "file" };',
        'import sdk from "./sdk.js" with { type: "file" };',
        "",
        `Object.assign(globalThis, { ${EMBEDDED_KEY}: { entry, sdk } });`,
        "",
      ].join("\n")
    );

    yield* fs.writeFileString(
      path.join(compile, "main.ts"),
      [
        'import "./runtime.ts";',
        `import ${JSON.stringify(path.join(root, "src", "bin.ts"))};`,
        "",
      ].join("\n")
    );

    /**
     * `node_modules` in a temp folder holding the native packages of
     * `target`'s machine, as each of `NATIVE` pins them: `bun install`
     * filtered them to this machine's. The versions are the installed
     * manifests' own exact pins.
     */
    const nativeFor = (target: string) =>
      Effect.gen(function* () {
        const machine = yield* Effect.fromOption(npmMachineOf(target)).pipe(
          Effect.mapError(
            () =>
              new BuildFailed({
                detail: `Bun names no machine ${target}`,
                step: "native packages",
              })
          )
        );

        const dependencies: Record<string, string> = {};

        for (const name of NATIVE) {
          const manifest = yield* path.fromFileUrl(
            new URL(import.meta.resolve(`${name}/package.json`))
          );

          const { optionalDependencies } = yield* fs
            .readFileString(manifest)
            .pipe(Effect.flatMap(Schema.decodeEffect(NativeManifest)));

          Object.assign(dependencies, optionalDependencies);
        }

        const folder = yield* fs.makeTempDirectoryScoped({
          prefix: `${Brand.slug}-native-`,
        });

        yield* fs.writeFileString(
          path.join(folder, "package.json"),
          JSON.stringify({ dependencies, name: "native", private: true })
        );

        yield* run(
          `native packages for ${target}`,
          "bun",
          [
            "install",
            "--no-save",
            `--os=${machine.os}`,
            `--cpu=${machine.cpu}`,
          ],
          { cwd: folder }
        );

        return path.join(folder, "node_modules");
      });

    // 4. The binaries, each with its credential helper link.
    const outputs =
      targets.length === 0
        ? [{ dir: path.join(dist, "bin"), target: Option.none<string>() }]
        : targets.map((target) => ({
            dir: path.join(dist, "bin", target),
            target: Option.some(target),
          }));

    for (const { dir, target } of outputs) {
      const env = yield* Option.match(target, {
        onNone: () => Effect.succeed({}),
        onSome: (name) =>
          Effect.map(nativeFor(name), (modules) => ({ NODE_PATH: modules })),
      });

      yield* run(
        "bun build --compile",
        "bun",
        compileArgs({
          entry: path.join(compile, "main.ts"),
          outfile: path.join(dir, Brand.cli),
          version,
          ...Option.match(target, {
            onNone: () => ({}),
            onSome: (name) => ({ target: name }),
          }),
        }),
        { env }
      );

      yield* fs.symlink(Brand.cli, path.join(dir, Brand.gitCredentialHelper));
    }
  }).pipe(Effect.scoped);

const targets = Flag.String("targets").pipe(
  Flag.withDescription(
    "Cross-compile for these Bun targets, comma-separated (linux-x64,darwin-arm64); each binary goes to dist/bin/<target>/."
  ),
  Flag.optional
);

const version = Flag.String("version").pipe(
  Flag.withDescription(
    `The version both builds are stamped with, which the CLI's --version prints (default ${UNSTAMPED}).`
  ),
  Flag.optional
);

/** The build's command line, running `then` with what it asks for. */
const command = <E, R>(
  then: (options: BuildOptions) => Effect.Effect<void, E, R>
) =>
  Command.make("build", { targets, version }, (flags) =>
    then({
      targets: Option.match(flags.targets, {
        onNone: () => [],
        onSome: (list) =>
          list
            .split(",")
            .map((target) => target.trim().replace(/^bun-/u, ""))
            .filter((target) => target.length > 0),
      }),
      version: Option.getOrElse(flags.version, () => UNSTAMPED),
    })
  ).pipe(
    Command.withDescription(
      "Build the CLI: the npm dist/, and a standalone binary that is also git's credential helper."
    )
  );

/**
 * The build's own `--version` takes a value, so effect/cli's built-in
 * `--version` (a boolean that prints and exits) is left out.
 */
const builtIns = CliConfig.make({
  builtIns: GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Version),
});

/** Runs `then` with what `argv`, the build's arguments, asks for. */
export const parseBuild = <E, R>(
  argv: readonly string[],
  then: (options: BuildOptions) => Effect.Effect<void, E, R>
) =>
  Command.runWith(command(then), { version: UNSTAMPED })(argv).pipe(
    Effect.provideService(CliConfig.CliConfig, builtIns)
  );

if (import.meta.main) {
  BunRuntime.runMain(
    Stdio.Stdio.use(({ args }) =>
      Effect.flatMap(args, (argv) => parseBuild(argv, make))
    ).pipe(Effect.provide(BunServices.layer))
  );
}
