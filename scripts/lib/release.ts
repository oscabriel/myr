/**
 * The release's core (issue 715): what the CLI's npm package says of
 * itself, which steps a release runs, and what it hands the platform's own
 * release storage. Pure; `scripts/release.ts` runs it.
 */
import type { Brand } from "@repo/brand";
import { detectHarness } from "@repo/protocol/audit";
import { Array as Arr, Option, Order, Predicate, Result, Schema } from "effect";

import { ReleaseManifest } from "../../apps/platform/src/releases.ts";
import { declaredStage, NoStage, UnknownStage } from "../../infra/stages.ts";
import { installScriptFor } from "./release/install-script.ts";

// --- What a release builds for -----------------------------------------------

/** The machines a release builds a binary for, as Bun names them. */
export type Target = "bun-linux-x64" | "bun-darwin-arm64";

export const targets: readonly Target[] = ["bun-linux-x64", "bun-darwin-arm64"];

/** A target as 416's build and the platform name it, without Bun's prefix: `linux-x64`. */
export const machineOf = (target: Target) => target.replace(/^bun-/u, "");

/** A target's binary, as the release folder and the platform name it: `<slug>-linux-x64`. */
export const binaryName = (brand: typeof Brand, target: Target) =>
  `${brand.slug}-${machineOf(target)}`;

// --- The npm package's dependencies ------------------------------------------

/**
 * A module statement as rolldown writes one, at the start of a line: an
 * `import … from "x"` or `export … from "x"`, over any number of lines, or a
 * side-effect `import "x"`. Prose and generated source inside strings never
 * start a line of the build with `import`, so they are not read as imports.
 */
const STATEMENT =
  /^(?:import|export)\b[^;"'`]*?\bfrom\s*["'](?<from>[^"']+)["']|^import\s*["'](?<bare>[^"']+)["']/gmu;

/** The package a bare specifier names: `@scope/name` or `name`, without a subpath. */
const packageOf = (specifier: string) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");

/** Whether `specifier` names a package, not a file or a runtime built-in. */
const isPackage = (specifier: string) => !/^(?:\.|\/|node:)/u.test(specifier);

/**
 * The packages a built module imports statically, by package name, sorted.
 * A package tsdown keeps external is imported this way; one reached only by
 * a dynamic `import()` would not be listed (none is today).
 */
export const importedPackages = (source: string): readonly string[] =>
  Arr.sort(
    Arr.dedupe(
      [...source.matchAll(STATEMENT)].flatMap(({ groups }) => {
        const specifier = groups?.from ?? groups?.bare ?? "";

        return isPackage(specifier) ? [packageOf(specifier)] : [];
      })
    ),
    Order.String
  );

/**
 * pi, the harness the package plugs into: a host package, so an optional
 * peer and never bundled or depended on (ratstack-pi §1.3 "Packages").
 */
const PI_HOST = "@earendil-works/pi-coding-agent";

/**
 * Packages the build imports that can't be pinned for npm: the CLI's
 * manifest doesn't declare them, they are workspace packages (tsdown inlines
 * those, so one left is a build fault), or their catalog has no version.
 */
export class Unpinned extends Schema.TaggedError<Unpinned>()("Unpinned", {
  packages: Schema.Array(Schema.String),
}) {}

/** The version a declared specifier pins, with `catalog:` read from the catalog. */
const pinOf = (
  specifier: string | undefined,
  catalogued: string | undefined
) => {
  const version = specifier === "catalog:" ? catalogued : specifier;

  return version === undefined || /^(?:workspace|catalog):/u.test(version)
    ? undefined
    : version;
};

/**
 * The published package's `dependencies`: each package the build imports,
 * at the version the CLI's manifest (`declared`) pins, `catalog:` resolved
 * from the workspace's catalog. pi is left out: the adapter imports it from
 * the host that loads it, an optional peer. Every other one is pinned, or
 * none is returned.
 */
export const pinnedDependencies = (input: {
  readonly imported: readonly string[];
  readonly declared: Readonly<Record<string, string>>;
  readonly catalog: Readonly<Record<string, string>>;
}): Result.Result<Readonly<Record<string, string>>, Unpinned> => {
  const pins = input.imported
    .filter((name) => name !== PI_HOST)
    .map(
      (name) =>
        [
          name,
          name.startsWith("@repo/")
            ? undefined
            : pinOf(input.declared[name], input.catalog[name]),
        ] as const
    );

  const unpinned = pins.flatMap(([name, version]) =>
    version === undefined ? [name] : []
  );

  return unpinned.length > 0
    ? Result.fail(new Unpinned({ packages: unpinned }))
    : Result.succeed(
        Object.fromEntries(
          pins.flatMap(([name, version]) =>
            version === undefined ? [] : [[name, version]]
          )
        )
      );
};

// --- The npm package's manifest ----------------------------------------------

/** The command line, under Node or Bun: 416's npm build. */
const BIN = "./dist/bin.js";

/** A library entry: its code, and the types tsgo declared for it. */
interface LibraryEntry {
  readonly types: string;
  readonly default: string;
}

/** The npm package's manifest, as `npm publish` reads it. */
export interface PublishManifest {
  readonly bin: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly description: string;
  readonly exports: Readonly<Record<string, string | LibraryEntry>>;
  readonly files: readonly string[];
  readonly keywords: readonly string[];
  readonly license: "MIT";
  readonly name: string;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta: Readonly<
    Record<string, { readonly optional: boolean }>
  >;
  readonly pi: {
    readonly extensions: readonly string[];
    readonly skills: readonly string[];
  };
  readonly publishConfig: { readonly access: "public" };
  readonly type: "module";
  readonly version: string;
}

/** A library entry of 416's build, by the name it is published under. */
const library = (name: "protocol" | "rules"): LibraryEntry =>
  // oxlint-disable-next-line sort-keys -- Node matches export conditions in key order and needs "default" last; TypeScript reads "types" only before it
  ({
    types: `./dist/${name}.d.ts`,
    default: `./dist/${name}.js`,
  });

/**
 * The npm package's manifest for `version`. Every name comes from `brand`:
 * the package, and one bin for each name the one entry answers to (as git's
 * credential helper, it reads its own name; 416's `src/bin.ts`).
 * `dependencies` are the packages the build imports, pinned
 * (`pinnedDependencies`). The `pi` key and the `pi-package` keyword make it
 * a pi package (`pi install npm:<package>`): pi loads the adapter at
 * `dist/pi.js` (706) and the platform's skill under `skills/`.
 */
export const publishManifest = (
  brand: typeof Brand,
  input: {
    readonly version: string;
    readonly dependencies: Readonly<Record<string, string>>;
  }
): PublishManifest => ({
  bin: { [brand.cli]: BIN, [brand.gitCredentialHelper]: BIN },
  dependencies: input.dependencies,
  description: `The ${brand.name} command line: find an ask, claim it, check your answer, and read its verdict; also git's credential helper, and a pi package.`,
  exports: {
    ".": BIN,
    "./protocol": library("protocol"),
    "./rules": library("rules"),
  },
  files: ["dist/", "skills/", "README.md", "LICENSE"],
  keywords: [brand.slug, "cli", "git", "pi-package"],
  license: "MIT",
  name: brand.cliPackage,
  peerDependencies: { [PI_HOST]: "*" },
  peerDependenciesMeta: { [PI_HOST]: { optional: true } },
  pi: { extensions: ["./dist/pi.js"], skills: ["./skills"] },
  publishConfig: { access: "public" },
  type: "module",
  version: input.version,
});

/** A path in the package, as the manifest writes it, from the package's root. */
const fromRoot = (file: string) =>
  file.replace(/^\.\//u, "").replace(/\/$/u, "");

/**
 * Every path the npm package's manifest points at (its bins, exports, pi's
 * extension and skills folder, and the README and licence it ships), from
 * the package's root, sorted: a staged package missing any of them is not
 * published.
 */
export const namedFiles = (manifest: PublishManifest): readonly string[] =>
  Arr.sort(
    Arr.dedupe(
      [
        ...Object.values(manifest.bin),
        ...Object.values(manifest.exports).flatMap((entry) =>
          Predicate.isString(entry) ? [entry] : [entry.default, entry.types]
        ),
        ...manifest.pi.extensions,
        ...manifest.pi.skills,
        ...manifest.files.filter((file) => !file.endsWith("/")),
      ].map(fromRoot)
    ),
    Order.String
  );

// --- The plan ----------------------------------------------------------------

/** One step of a release, in the order a release runs them. */
export type ReleaseStep =
  | "tsdown"
  | "manifest"
  | "copySkills"
  | "compile"
  | "installScript"
  | "checksums"
  | "upload"
  | "publish";

/** `npm publish` runs only when a person runs the release (H2). */
export class PublishNeedsAPerson extends Schema.TaggedError<PublishNeedsAPerson>()(
  "PublishNeedsAPerson",
  { markers: Schema.Array(Schema.String) }
) {}

/**
 * The env names that say an agent runs this process: each one that alone
 * makes `@repo/protocol/audit`'s `detectHarness` name a harness (W4 401
 * keeps that table once; this reads it, never copies it), sorted.
 */
export const agentMarkers = (
  env: Readonly<Record<string, string | undefined>>
): readonly string[] =>
  Arr.sort(
    Object.keys(env).filter(
      (key) => detectHarness({ [key]: env[key] }).harness !== undefined
    ),
    Order.String
  );

/** What a build makes: 416's build, then the package and the binaries beside it. */
const BUILD: readonly ReleaseStep[] = [
  "tsdown",
  "manifest",
  "copySkills",
  "compile",
];

/** What a build or an upload ends with: the install script for its origin, and the digests. */
const RELEASE_FILES: readonly ReleaseStep[] = ["installScript", "checksums"];

/**
 * The steps a release runs, in order: `build` (416's build with both
 * targets, the npm package and the binaries), the install script and the
 * checksums, `upload` to the stage's own release storage, and `publish`
 * last. An upload names a stage the repo declares (`dev-oscabriel` or
 * `demo`); a stage given to a build only says whose origin the install
 * script fetches from, and is checked the same way. Under any agent's env,
 * a plan that publishes is refused whole (H2): the script prints the
 * command for a person to run instead.
 */
export const releasePlan = (input: {
  readonly build: boolean;
  readonly upload: boolean;
  readonly stage?: string;
  readonly publish: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Result.Result<
  readonly ReleaseStep[],
  PublishNeedsAPerson | NoStage | UnknownStage
> => {
  const markers = input.publish ? agentMarkers(input.env) : [];

  if (markers.length > 0) {
    return Result.fail(new PublishNeedsAPerson({ markers }));
  }

  if (input.stage === undefined && input.upload) {
    return Result.fail(new NoStage());
  }

  if (input.stage !== undefined && Option.isNone(declaredStage(input.stage))) {
    return Result.fail(new UnknownStage({ stage: input.stage }));
  }

  return Result.succeed([
    ...(input.build ? BUILD : []),
    ...(input.build || input.upload ? RELEASE_FILES : []),
    ...(input.upload ? (["upload"] as const) : []),
    ...(input.publish ? (["publish"] as const) : []),
  ]);
};

// --- The version -------------------------------------------------------------

/**
 * An upload or a publish names its `--version`, and it is one the platform
 * serves: semver, never `latest` (`given` is the one that isn't).
 */
export class VersionNeeded extends Schema.TaggedError<VersionNeeded>()(
  "VersionNeeded",
  { given: Schema.optionalKey(Schema.String) }
) {
  override get message() {
    return this.given === undefined
      ? "an upload or a publish names its --version (semver, such as 0.1.0)"
      : `--version ${this.given} is not a version the platform serves (semver, such as 0.1.0)`;
  }
}

/**
 * Whether the platform serves `version`: its manifest decodes with it as
 * the latest release (420's schema holds the one rule for a version).
 */
const served = (version: string) =>
  Option.isSome(
    Schema.decodeOption(ReleaseManifest)({
      latest: version,
      versions: { [version]: { assets: {} } },
    })
  );

/**
 * What the CLI reports itself as until a build stamps it (416 #6: `main.ts`
 * says `0.0.0`), and so what a build that neither uploads nor publishes is.
 */
const UNRELEASED = "0.0.0";

/**
 * The release's version: `version` as given, which an upload or a publish
 * must name, and which must be one the platform serves.
 */
export const releaseVersion = (input: {
  readonly version?: string;
  readonly upload: boolean;
  readonly publish: boolean;
}): Result.Result<string, VersionNeeded> => {
  if (input.version === undefined) {
    return input.upload || input.publish
      ? Result.fail(new VersionNeeded({}))
      : Result.succeed(UNRELEASED);
  }

  return served(input.version)
    ? Result.succeed(input.version)
    : Result.fail(new VersionNeeded({ given: input.version }));
};

// --- The platform's release storage ------------------------------------------

/** One file of a release, as the manifest lists it. */
export interface ReleaseAsset {
  readonly sha256: string;
  readonly bytes: number;
}

export { ReleaseManifest } from "../../apps/platform/src/releases.ts";

/**
 * `releases/manifest.json` once `version` is released with `assets`: every
 * version `previous` lists, kept, and `version`, now latest. It is the shape
 * the platform decodes and serves from (420's `ReleaseManifest`, the one
 * schema both sides use).
 */
export const releaseManifest = (input: {
  readonly version: string;
  readonly previous: ReleaseManifest | undefined;
  readonly assets: Readonly<Record<string, ReleaseAsset>>;
}): ReleaseManifest => ({
  latest: input.version,
  versions: {
    ...input.previous?.versions,
    [input.version]: { assets: input.assets },
  },
});

/**
 * `version` is already released with other bytes. The platform serves a
 * version's files as immutable, so a client may keep the old ones for good:
 * a changed release needs a new `--version`.
 */
export class VersionReleased extends Schema.TaggedError<VersionReleased>()(
  "VersionReleased",
  { version: Schema.String }
) {
  override get message() {
    return `${this.version} is already released with other bytes, and its files are cached for good: release a new --version`;
  }
}

/** Two releases hold the same files, by name, size and digest. */
const sameAssets = (
  one: Readonly<Record<string, ReleaseAsset>>,
  other: Readonly<Record<string, ReleaseAsset>>
) =>
  Object.keys(one).length === Object.keys(other).length &&
  Object.entries(one).every(
    ([name, { bytes, sha256 }]) =>
      other[name]?.bytes === bytes && other[name]?.sha256 === sha256
  );

/**
 * Whether `assets` may be released as `version`: it is new, or it is
 * released already with exactly these files (an upload run again).
 */
export const unreleased = (input: {
  readonly version: string;
  readonly previous: ReleaseManifest | undefined;
  readonly assets: Readonly<Record<string, ReleaseAsset>>;
}): Result.Result<void, VersionReleased> => {
  const released = input.previous?.versions[input.version];

  return released === undefined || sameAssets(released.assets, input.assets)
    ? Result.void
    : Result.fail(new VersionReleased({ version: input.version }));
};

/** Where the manifest is kept: every release file is under `releases/`. */
export const MANIFEST_KEY = "releases/manifest.json";

/** Files by name, sorted (`Order.String`), as both sides list them. */
const byName = <A>(record: Readonly<Record<string, A>>) =>
  Arr.sortWith(Object.entries(record), ([name]) => name, Order.String);

/**
 * `SHA256SUMS`: one `<sha256>  <name>` line per file, sorted by name, as
 * `sha256sum` prints them and as the platform makes the one it serves from
 * the manifest (issue 420).
 */
export const checksumsFile = (
  assets: Readonly<Record<string, ReleaseAsset>>
): string =>
  byName(assets)
    .map(([name, { sha256 }]) => `${sha256}  ${name}\n`)
    .join("");

/**
 * What an upload puts where, in order: every file of `version` under
 * `releases/<version>/`, sorted, and `releases/manifest.json` last, so the
 * manifest never names a file the bucket lacks (420 #5).
 */
export const uploads = (input: {
  readonly version: string;
  readonly files: readonly string[];
}): readonly { readonly file: string; readonly key: string }[] => [
  ...Arr.sort(input.files, Order.String).map((file) => ({
    file,
    key: `releases/${input.version}/${file}`,
  })),
  { file: "manifest.json", key: MANIFEST_KEY },
];

// --- The install script ------------------------------------------------------

/**
 * `curl -fsSL <origin>/install.sh | sh` for `version`, whose files the
 * platform serves at `baseUrl` (`<origin>/releases/<version>`, issue 420):
 * the binary for the machine, checked against `SHA256SUMS` before it is
 * installed as `brand.cli`, with `brand.gitCredentialHelper` linked to it.
 */
export const installScript = (input: {
  readonly brand: typeof Brand;
  readonly version: string;
  readonly baseUrl: string;
}): string => installScriptFor({ ...input, machines: targets.map(machineOf) });
