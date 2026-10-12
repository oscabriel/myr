import type { Brand } from "@repo/brand";
import { detectHarness } from "@repo/protocol/audit";
import { Array as Arr, Option, Order, Predicate, Result, Schema } from "effect";

import { ReleaseManifest } from "../../apps/platform/src/releases.ts";
import { declaredStage, NoStage, UnknownStage } from "../../infra/stages.ts";
import { installScriptFor } from "./release/install-script.ts";

export type Target = "bun-linux-x64" | "bun-darwin-arm64";

export const targets: readonly Target[] = ["bun-linux-x64", "bun-darwin-arm64"];

export const machineOf = (target: Target) => target.replace(/^bun-/u, "");

export const binaryName = (brand: typeof Brand, target: Target) =>
  `${brand.slug}-${machineOf(target)}`;

/**
 * A module statement as rolldown writes one, at the start of a line. A
 * template literal's line that starts with `import` and names a package is
 * read as an import too, which fails the pin loudly rather than slip through.
 */
const STATEMENT =
  /^(?:import|export)\b[^;"'`]*?\bfrom\s*["'](?<from>[^"']+)["']|^import\s*["'](?<bare>[^"']+)["']/gmu;

const packageOf = (specifier: string) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");

const isPackage = (specifier: string) => !/^(?:\.|\/|node:)/u.test(specifier);

/** Static imports only: a package reached only by a dynamic `import()` is not listed. */
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

/** The host the package plugs into: an optional peer, never bundled or depended on. */
const PI_HOST = "@earendil-works/pi-coding-agent";

export class Unpinned extends Schema.TaggedError<Unpinned>()("Unpinned", {
  packages: Schema.Array(Schema.String),
}) {}

const pinOf = (
  specifier: string | undefined,
  catalogued: string | undefined
) => {
  const version = specifier === "catalog:" ? catalogued : specifier;

  return version === undefined || /^(?:workspace|catalog):/u.test(version)
    ? undefined
    : version;
};

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

const BIN = "./dist/bin.js";

interface LibraryEntry {
  readonly types: string;
  readonly default: string;
}

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

const library = (name: "protocol" | "rules"): LibraryEntry =>
  // oxlint-disable-next-line sort-keys -- Node matches export conditions in key order and needs "default" last; TypeScript reads "types" only before it
  ({
    types: `./dist/${name}.d.ts`,
    default: `./dist/${name}.js`,
  });

/**
 * Both bins point at one entry, which reads its own name to act as git's
 * credential helper. The `pi` key and `pi-package` keyword make it a pi package.
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

const fromRoot = (file: string) =>
  file.replace(/^\.\//u, "").replace(/\/$/u, "");

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

export type ReleaseStep =
  | "tsdown"
  | "manifest"
  | "copySkills"
  | "compile"
  | "installScript"
  | "checksums"
  | "upload"
  | "publish";

export class PublishNeedsAPerson extends Schema.TaggedError<PublishNeedsAPerson>()(
  "PublishNeedsAPerson",
  { markers: Schema.Array(Schema.String) }
) {}

// Reads `detectHarness`'s table rather than copying it.
export const agentMarkers = (
  env: Readonly<Record<string, string | undefined>>
): readonly string[] =>
  Arr.sort(
    Object.keys(env).filter(
      (key) => detectHarness({ [key]: env[key] }).harness !== undefined
    ),
    Order.String
  );

const BUILD: readonly ReleaseStep[] = [
  "tsdown",
  "manifest",
  "copySkills",
  "compile",
];

const RELEASE_FILES: readonly ReleaseStep[] = ["installScript", "checksums"];

export interface ReleaseFlags {
  readonly build: boolean;
  readonly upload: boolean;
  readonly stage?: string;
  readonly publish: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}

const stepsOf = (
  flags: ReleaseFlags
): Result.Result<readonly ReleaseStep[], NoStage | UnknownStage> => {
  if (flags.stage === undefined && flags.upload) {
    return Result.fail(new NoStage());
  }

  if (flags.stage !== undefined && Option.isNone(declaredStage(flags.stage))) {
    return Result.fail(new UnknownStage({ stage: flags.stage }));
  }

  return Result.succeed([
    ...(flags.build ? BUILD : []),
    ...(flags.build || flags.upload ? RELEASE_FILES : []),
    ...(flags.upload ? (["upload"] as const) : []),
    ...(flags.publish ? (["publish"] as const) : []),
  ]);
};

export const releasePlan = (
  flags: ReleaseFlags
): Result.Result<
  readonly ReleaseStep[],
  PublishNeedsAPerson | NoStage | UnknownStage
> => {
  const markers = flags.publish ? agentMarkers(flags.env) : [];

  return markers.length > 0
    ? Result.fail(new PublishNeedsAPerson({ markers }))
    : stepsOf(flags);
};

export interface ReleaseRun {
  readonly steps: readonly ReleaseStep[];
  readonly handOver: readonly string[];
}

/**
 * Under an agent, a run that publishes still runs every other step it names
 * and hands the publish to a person instead of running it.
 */
export const releaseRun = (
  flags: ReleaseFlags
): Result.Result<ReleaseRun, NoStage | UnknownStage> => {
  const handOver = flags.publish ? agentMarkers(flags.env) : [];

  return Result.map(
    stepsOf({ ...flags, publish: flags.publish && handOver.length === 0 }),
    (steps) => ({ handOver, steps })
  );
};

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

const served = (version: string) =>
  Option.isSome(
    Schema.decodeOption(ReleaseManifest)({
      latest: version,
      versions: { [version]: { assets: {} } },
    })
  );

const UNRELEASED = "0.0.0";

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

export interface ReleaseAsset {
  readonly sha256: string;
  readonly bytes: number;
}

export { ReleaseManifest } from "../../apps/platform/src/releases.ts";

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

export class VersionReleased extends Schema.TaggedError<VersionReleased>()(
  "VersionReleased",
  { version: Schema.String }
) {
  override get message() {
    return `${this.version} is already released with other bytes, and its files are cached for good: release a new --version`;
  }
}

const sameAssets = (
  one: Readonly<Record<string, ReleaseAsset>>,
  other: Readonly<Record<string, ReleaseAsset>>
) =>
  Object.keys(one).length === Object.keys(other).length &&
  Object.entries(one).every(
    ([name, { bytes, sha256 }]) =>
      other[name]?.bytes === bytes && other[name]?.sha256 === sha256
  );

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

export const MANIFEST_KEY = "releases/manifest.json";

const byName = <A>(record: Readonly<Record<string, A>>) =>
  Arr.sortWith(Object.entries(record), ([name]) => name, Order.String);

export const checksumsFile = (
  assets: Readonly<Record<string, ReleaseAsset>>
): string =>
  byName(assets)
    .map(([name, { sha256 }]) => `${sha256}  ${name}\n`)
    .join("");

// The manifest goes last, so it never names a file the bucket lacks.
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

export const installScript = (input: {
  readonly brand: typeof Brand;
  readonly version: string;
  readonly baseUrl: string;
}): string => installScriptFor({ ...input, machines: targets.map(machineOf) });
