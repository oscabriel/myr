// The compiled binary has no bun on the PATH, and a `bun` child can't read its embedded `/$bunfs/`,
// so `build.ts` embeds both modules bundled whole and the binary unpacks them and runs itself as bun.
import { Brand } from "@repo/brand";
import { RulesFailed } from "@repo/rules/rules-evaluator";
import { Context, Effect, FileSystem, Option, Path, Schema } from "effect";
import type { Scope } from "effect";

export interface ConfigModules {
  readonly sdk: string;
  readonly entry: Option.Option<string>;
  readonly packages: Option.Option<string>;
}

export interface ConfigBun {
  readonly bun: string;
  readonly env: Readonly<Record<string, string>>;
  readonly modules: Effect.Effect<
    ConfigModules,
    RulesFailed,
    FileSystem.FileSystem | Path.Path | Scope.Scope
  >;
}

const loadFailed = (detail: string) =>
  new RulesFailed({ detail, reason: "load" });

/** Looked up only when a TypeScript folder is bundled: a build with no copy on disk still reads `policy.json`. */
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

const packagesOf = (file: string) => {
  const at = file.lastIndexOf(`${NODE_MODULES}/`);

  return at === -1
    ? Option.none()
    : Option.some(file.slice(0, at + NODE_MODULES.length));
};

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

export const EMBEDDED_KEY = "__configRuntime";

const Embedded = Schema.Struct({
  [EMBEDDED_KEY]: Schema.Struct({
    entry: Schema.NonEmptyString,
    sdk: Schema.NonEmptyString,
  }),
  process: Schema.Struct({ execPath: Schema.NonEmptyString }),
});

/** `bun build` and a `bun` child read only real files, so the embedded modules are copied to a temp folder. */
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
