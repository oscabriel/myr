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

// Re-exported: tsdown.config.ts defines it, as importing this module would be a cycle.
export { versionDefine } from "./tsdown.config.ts";

export interface BuildOptions {
  readonly targets: readonly string[];
  readonly version: string;
}

export const compileArgs = (input: {
  readonly entry: string;
  readonly outfile: string;
  readonly target?: string;
  readonly version: string;
}) => [
  "build",
  "--compile",
  // Bytecode: the binary starts by loading its bundle, and a bytecode cache
  // skips the parse of the whole bundle each start. ESM is what bytecode takes.
  "--bytecode",
  "--format=esm",
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

interface Tsconfig {
  readonly compilerOptions: {
    readonly declaration?: boolean;
    readonly emitDeclarationOnly?: boolean;
    readonly noCheck?: boolean;
    readonly noEmit?: boolean;
    readonly outDir?: string;
    readonly paths: Readonly<Record<string, readonly string[]>>;
    readonly rootDir?: string;
  };
  readonly extends?: string;
  readonly files: readonly string[];
  readonly include?: readonly string[];
}

const NativeManifest = Schema.fromJsonString(
  Schema.Struct({
    optionalDependencies: Schema.Record(Schema.String, Schema.String),
  })
);

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    exports: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    name: Schema.String,
  })
);

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

    const tsconfigIn = (dir: string, name: string, config: Tsconfig) =>
      Effect.as(
        fs.writeFileString(path.join(dir, name), JSON.stringify(config)),
        path.join(dir, name)
      );

    for (const config of npm(version)) {
      yield* tsdown(`tsdown ${Object.keys(config.entry).join(", ")}`, {
        ...config,
        config: false,
        cwd: root,
      });
    }

    // A fixed path, not a temp folder: the bundled .d.ts files keep each
    // source path in a comment, so a random name would change every build.
    const scratch = path.join(dist, ".types");

    yield* Effect.acquireRelease(
      fs.makeDirectory(scratch, { recursive: true }),
      () => Effect.orDie(fs.remove(scratch, { recursive: true }))
    );

    const declared = path.join(scratch, "declared");

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

    // Bundled whole (a machine with only the binary has no node_modules);
    // runtime.ts sets their embedded paths before src/bin.ts runs.
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

    /** `bun install` installed only this machine's native packages. */
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

// The build's `--version` takes a value, so effect/cli's boolean one is dropped.
const builtIns = CliConfig.make({
  builtIns: GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Version),
});

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
