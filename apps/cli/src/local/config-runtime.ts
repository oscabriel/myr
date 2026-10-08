/**
 * How this CLI runs bun for a TypeScript config folder: the command, what it
 * needs in its env, and the two modules the bundle and the rules sandbox
 * import (the sdk, and the rules' entry). Run from source or the npm build,
 * that is `bun` on the `PATH` and this CLI's own copies of the modules.
 *
 * The compiled binary can use neither: a machine that has only the binary
 * has no bun, and its modules live in Bun's embedded `/$bunfs/`, which a
 * `bun` child can't read. So `build.ts` bundles both modules whole (effect
 * inlined) and embeds them, and hands their embedded paths to this module
 * through the global scope before the CLI starts. Then each use unpacks them
 * into a temp folder of its own, and the binary runs itself as bun
 * (`BUN_BE_BUN=1`).
 */
import { Brand } from "@repo/brand";
import { RulesFailed } from "@repo/rules/rules-evaluator";
import { Context, Effect, FileSystem, Option, Path, Schema } from "effect";
import type { Scope } from "effect";

/** The modules a bun child imports for one use of the config folder. */
export interface ConfigModules {
  /** The sdk: what the folder's imports of it point at. */
  readonly sdk: string;
  /** The rules' entry, when this CLI carries its own copy on disk. */
  readonly entry: Option.Option<string>;
  /** A `node_modules` the folder's other bare imports resolve in. */
  readonly packages: Option.Option<string>;
}

/** How this CLI runs bun for a config folder, and the modules it hands it. */
export interface ConfigBun {
  /** The command that runs bun. */
  readonly bun: string;
  /** What that command needs in its env beside the rest of it. */
  readonly env: Readonly<Record<string, string>>;
  /** The modules, ready for one scope's use. */
  readonly modules: Effect.Effect<
    ConfigModules,
    RulesFailed,
    FileSystem.FileSystem | Path.Path | Scope.Scope
  >;
}

const loadFailed = (detail: string) =>
  new RulesFailed({ detail, reason: "load" });

/**
 * The file this CLI's own copy of `specifier` is, looked up only when a
 * TypeScript folder is bundled: a build of the CLI that carries no copy on
 * disk still reads a `policy.json` or the defaults.
 */
const ownCopyOf = (path: Path.Path, specifier: string) =>
  Effect.try({
    catch: () =>
      loadFailed(
        `this build of ${Brand.cli} carries no ${specifier} to bundle the config folder with`
      ),
    try: () => new URL(import.meta.resolve(specifier)),
  }).pipe(
    Effect.flatMap((url) =>
      path
        .fromFileUrl(url)
        .pipe(
          Effect.mapError(() =>
            loadFailed(
              `this build of ${Brand.cli} keeps its ${specifier} where bun build cannot read it`
            )
          )
        )
    )
  );

const NODE_MODULES = "/node_modules";

/** The `node_modules` folder a resolved module sits in. */
const packagesOf = (file: string) => {
  const at = file.lastIndexOf(`${NODE_MODULES}/`);

  return at === -1
    ? Option.none()
    : Option.some(file.slice(0, at + NODE_MODULES.length));
};

/** Run from source or the npm build: `bun` on the `PATH`, and this CLI's own modules. */
export const ConfigRuntimeOwn: ConfigBun = {
  bun: "bun",
  env: {},
  modules: Effect.gen(function* () {
    const path = yield* Path.Path;
    const sdk = yield* ownCopyOf(path, "@repo/sdk");
    const effect = yield* ownCopyOf(path, "effect");

    return { entry: Option.none(), packages: packagesOf(effect), sdk };
  }),
};

/**
 * What `build.ts` hands the compiled binary through the global scope: the
 * embedded paths of the bundled sdk and rules entry.
 */
export const EMBEDDED_KEY = "__configRuntime";

const Embedded = Schema.Struct({
  [EMBEDDED_KEY]: Schema.Struct({
    entry: Schema.NonEmptyString,
    sdk: Schema.NonEmptyString,
  }),
  process: Schema.Struct({ execPath: Schema.NonEmptyString }),
});

/**
 * The compiled binary's runtime: itself as bun, and the embedded modules
 * copied into a temp folder for the scope (`bun build` and a `bun` child
 * read only real files).
 */
export const configRuntimeEmbedded = (embedded: {
  readonly execPath: string;
  readonly entry: string;
  readonly sdk: string;
}): ConfigBun => ({
  bun: embedded.execPath,
  env: { BUN_BE_BUN: "1" },
  modules: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const unpacked = Effect.gen(function* () {
      const dir = yield* fs.makeTempDirectoryScoped({
        prefix: "config-runtime-",
      });

      const sdk = path.join(dir, "sdk.js");
      const entry = path.join(dir, "entry.js");

      yield* fs.writeFile(sdk, yield* fs.readFile(embedded.sdk));
      yield* fs.writeFile(entry, yield* fs.readFile(embedded.entry));

      return { entry: Option.some(entry), packages: Option.none(), sdk };
    });

    return yield* unpacked.pipe(
      Effect.mapError((failure) =>
        loadFailed(
          `could not unpack this ${Brand.cli}'s sdk to bundle the config folder with: ${failure.message}`
        )
      )
    );
  }),
});

/**
 * The runtime this process has: the compiled binary's when `build.ts` handed
 * it the embedded modules, else this CLI's own.
 */
export const ConfigRuntime = Context.Reference<ConfigBun>("cli/ConfigRuntime", {
  defaultValue: () => {
    // Unknown on purpose: the runtime is whatever started this process.
    const scope: unknown = globalThis;

    return Option.match(Schema.decodeUnknownOption(Embedded)(scope), {
      onNone: () => ConfigRuntimeOwn,
      onSome: (found) =>
        configRuntimeEmbedded({
          ...found[EMBEDDED_KEY],
          execPath: found.process.execPath,
        }),
    });
  },
});
