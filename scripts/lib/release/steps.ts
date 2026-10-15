import { commandDocs } from "@repo/agent-kit/command-doc";
import { platformSkill } from "@repo/agent-kit/platform";
import { Brand } from "@repo/brand";
import { Contracts } from "@repo/protocol/contracts";
import {
  Array as Arr,
  Console,
  Crypto,
  Effect,
  FileSystem,
  Match,
  Option,
  Order,
  Path,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { resources } from "../../../infra/stages.ts";
import type { Stage } from "../../../infra/stages.ts";
import {
  binaryName,
  checksumsFile,
  importedPackages,
  installScript,
  machineOf,
  MANIFEST_KEY,
  namedFiles,
  pinnedDependencies,
  publishManifest,
  ReleaseManifest,
  releaseManifest,
  servedAsLatest,
  targets,
  unreleased,
  uploads,
} from "../release.ts";
import type { ReleaseAsset, ReleaseStep } from "../release.ts";
import { packageReadme } from "./readme.ts";

export class ReleaseFailed extends Schema.TaggedError<ReleaseFailed>()(
  "ReleaseFailed",
  { reason: Schema.String, step: Schema.String }
) {
  override get message() {
    return `${this.step}: ${this.reason}`;
  }
}

export interface Layout {
  readonly root: string;
  readonly cli: string;
  readonly dist: string;
  readonly release: string;
  /** Staged outside `dist/`, whose `bin/` holds the binaries npm must not ship. */
  readonly npm: string;
}

export const layoutOf = (root: string) =>
  Effect.map(Path.Path, (path): Layout => {
    const cli = path.join(root, "apps", "cli");
    const release = path.join(cli, "release");

    return {
      cli,
      dist: path.join(cli, "dist"),
      npm: path.join(release, "npm"),
      release,
      root,
    };
  });

export interface Release {
  readonly version: string;
  readonly origin: string;
  readonly stage: Option.Option<Stage>;
}

export const publishCommand = (layout: Layout, path: Path.Path) =>
  `npm publish ${path.relative(layout.root, layout.npm)} --access public`;

const failed = (step: ReleaseStep, reason: string) =>
  new ReleaseFailed({ reason, step });

const run = (
  step: ReleaseStep,
  command: string,
  args: readonly string[],
  cwd: string
) =>
  Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
    spawner.exitCode(
      ChildProcess.make(command, args, {
        cwd,
        stderr: "inherit",
        stdin: "inherit",
        stdout: "inherit",
      })
    )
  ).pipe(
    Effect.mapError(({ message }) => failed(step, message)),
    Effect.filterOrFail(
      (exitCode) => exitCode === 0,
      (exitCode) =>
        failed(step, `${command} ${args.join(" ")} exited ${exitCode}`)
    ),
    Effect.asVoid
  );

const PackageJson = Schema.fromJsonString(
  Schema.Struct({
    dependencies: Schema.optionalKey(
      Schema.Record(Schema.String, Schema.String)
    ),
    version: Schema.optionalKey(Schema.String),
    workspaces: Schema.optionalKey(
      Schema.Struct({
        catalog: Schema.optionalKey(
          Schema.Record(Schema.String, Schema.String)
        ),
      })
    ),
  })
);

const readPackage = (step: ReleaseStep, file: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(file)).pipe(
    Effect.flatMap(Schema.decodeEffect(PackageJson)),
    Effect.mapError(({ message }) => failed(step, `${file}: ${message}`))
  );

const builtFiles = (layout: Layout) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const names = yield* fs.readDirectory(layout.dist);

    const files = yield* Effect.filter(
      names.filter((name) => /\.(?:js|d\.ts)$/u.test(name)),
      (name) =>
        Effect.map(
          fs.stat(path.join(layout.dist, name)),
          ({ type }) => type === "File"
        )
    );

    return Arr.sort(files, Order.String);
  });

const stagePackage = (layout: Layout, release: Release) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const files = yield* builtFiles(layout).pipe(
      Effect.filterOrFail(
        (names) => names.includes("bin.js"),
        () =>
          failed(
            "manifest",
            "apps/cli/dist has no bin.js: build first (--build)"
          )
      )
    );

    yield* fs.remove(layout.npm, { force: true, recursive: true });
    yield* fs.makeDirectory(path.join(layout.npm, "dist"), { recursive: true });

    const sources = yield* Effect.forEach(files, (name) =>
      fs
        .copyFile(
          path.join(layout.dist, name),
          path.join(layout.npm, "dist", name)
        )
        .pipe(Effect.andThen(fs.readFileString(path.join(layout.dist, name))))
    );

    const cli = yield* readPackage(
      "manifest",
      path.join(layout.cli, "package.json")
    );

    const workspace = yield* readPackage(
      "manifest",
      path.join(layout.root, "package.json")
    );

    const dependencies = yield* Effect.fromResult(
      pinnedDependencies({
        catalog: workspace.workspaces?.catalog ?? {},
        declared: cli.dependencies ?? {},
        imported: Arr.sort(
          Arr.dedupe(sources.flatMap(importedPackages)),
          Order.String
        ),
      })
    ).pipe(
      Effect.mapError(({ packages }) =>
        failed(
          "manifest",
          `the build imports ${packages.join(", ")}, which apps/cli/package.json doesn't pin`
        )
      )
    );

    const manifest = publishManifest(Brand, {
      dependencies,
      version: release.version,
    });

    yield* fs.writeFileString(
      path.join(layout.npm, "package.json"),
      `${JSON.stringify(manifest, undefined, 2)}\n`
    );

    yield* fs.writeFileString(
      path.join(layout.npm, "README.md"),
      packageReadme({ brand: Brand, version: release.version })
    );

    yield* fs.copyFile(
      path.join(layout.root, "LICENSE"),
      path.join(layout.npm, "LICENSE")
    );

    return manifest;
  });

const writeSkills = (layout: Layout) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const skills = yield* platformSkill({ commands: commandDocs(Contracts) });

    yield* Effect.forEach(skills, ({ content, path: file }) =>
      Effect.andThen(
        fs.makeDirectory(path.dirname(path.join(layout.npm, file)), {
          recursive: true,
        }),
        fs.writeFileString(path.join(layout.npm, file), content)
      )
    );
  });

const collectBinaries = (layout: Layout) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    yield* fs.makeDirectory(layout.release, { recursive: true });

    return yield* Effect.forEach(targets, (target) =>
      Effect.gen(function* () {
        const built = path.join(
          layout.dist,
          "bin",
          machineOf(target),
          Brand.cli
        );

        const released = path.join(layout.release, binaryName(Brand, target));

        yield* fs.exists(built).pipe(
          Effect.filterOrFail(
            (exists) => exists,
            () =>
              failed(
                "compile",
                `${path.relative(layout.root, built)} is missing: build first (--build)`
              )
          )
        );

        yield* fs.copyFile(built, released);
        yield* fs.chmod(released, 0o755);

        return released;
      })
    );
  });

const releasedFiles = [
  ...targets.map((target) => binaryName(Brand, target)),
  "install.sh",
];

const assetOf = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;
    const bytes = yield* fs.readFile(file);
    const digest = yield* crypto.digest("SHA-256", bytes);

    return {
      bytes: bytes.length,
      sha256: [...digest]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    } satisfies ReleaseAsset;
  });

const assetsIn = (layout: Layout) =>
  Effect.flatMap(Path.Path, (path) =>
    Effect.forEach(releasedFiles, (name) =>
      Effect.map(
        assetOf(path.join(layout.release, name)),
        (asset) => [name, asset] as const
      )
    )
  ).pipe(Effect.map((entries) => Object.fromEntries(entries)));

const writeChecksums = (layout: Layout) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const assets = yield* assetsIn(layout);

    yield* fs.writeFileString(
      path.join(layout.release, "SHA256SUMS"),
      checksumsFile(assets)
    );
  });

/** How the bucket keeps each file: the platform sets its own reply headers. */
const contentTypes = new Map([
  ["install.sh", "text/x-shellscript; charset=utf-8"],
  ["manifest.json", "application/json"],
]);

const contentTypeOf = (file: string) =>
  contentTypes.get(file) ?? "application/octet-stream";

const wranglerOf = (layout: Layout, path: Path.Path) =>
  path.join(
    layout.root,
    "apps",
    "platform",
    "node_modules",
    ".bin",
    "wrangler"
  );

// Wrangler's own login, never the read-mostly infra token.
const wrangler = (
  step: ReleaseStep,
  layout: Layout,
  cwd: string,
  args: readonly string[]
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const child = yield* spawner.spawn(
      ChildProcess.make(wranglerOf(layout, path), args, {
        cwd,
        env: {
          CLOUDFLARE_API_TOKEN: undefined,
          WRANGLER_SEND_METRICS: "false",
        },
        extendEnv: true,
      })
    );

    const [output, exitCode] = yield* Effect.all(
      [Stream.mkString(Stream.decodeText(child.all)), child.exitCode],
      { concurrency: "unbounded" }
    );

    return { exitCode: Number(exitCode), output };
  }).pipe(
    Effect.scoped,
    Effect.mapError(({ message }) =>
      failed(step, `wrangler didn't run: ${message}`)
    )
  );

const NO_SUCH_KEY = "The specified key does not exist";

const bucketManifest = (
  step: ReleaseStep,
  layout: Layout,
  bucket: string,
  scratch: string
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(scratch, "previous.json");

    const got = yield* wrangler(step, layout, scratch, [
      "r2",
      "object",
      "get",
      `${bucket}/${MANIFEST_KEY}`,
      "--remote",
      "--file",
      file,
    ]);

    if (got.exitCode !== 0) {
      return got.output.includes(NO_SUCH_KEY)
        ? Option.none()
        : yield* failed(
            step,
            `wrangler r2 object get ${bucket}/${MANIFEST_KEY} failed:\n${got.output.trim()}`
          );
    }

    const text = yield* fs.readFileString(file);

    return Option.some(
      yield* Schema.decodeEffect(Schema.fromJsonString(ReleaseManifest))(
        text
      ).pipe(
        Effect.mapError(({ message }) =>
          failed(
            step,
            `${bucket}/${MANIFEST_KEY} doesn't decode, so the platform answers 503 until it is fixed by hand: ${message}`
          )
        )
      )
    );
  });

const upload = (layout: Layout, release: Release) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const stage = yield* Effect.fromOption(release.stage).pipe(
      Effect.mapError(() => failed("upload", "an upload names its --stage"))
    );

    const bucket = resources(stage).releases;

    const scratch = yield* fs.makeTempDirectoryScoped({
      prefix: "release-715-",
    });

    const previous = yield* bucketManifest("upload", layout, bucket, scratch);
    const assets = yield* assetsIn(layout);

    yield* Effect.fromResult(
      unreleased({
        assets,
        previous: Option.getOrUndefined(previous),
        version: release.version,
      })
    ).pipe(Effect.mapError(({ message }) => failed("upload", message)));

    const manifest = releaseManifest({
      assets,
      previous: Option.getOrUndefined(previous),
      version: release.version,
    });

    yield* fs.writeFileString(
      path.join(layout.release, "manifest.json"),
      `${yield* Schema.encodeEffect(Schema.fromJsonString(ReleaseManifest))(
        manifest
      ).pipe(Effect.mapError(({ message }) => failed("upload", message)))}\n`
    );

    for (const { file, key } of uploads({
      files: Object.keys(assets),
      version: release.version,
    })) {
      yield* wrangler("upload", layout, scratch, [
        "r2",
        "object",
        "put",
        `${bucket}/${key}`,
        "--remote",
        "--file",
        path.join(layout.release, file),
        "--content-type",
        contentTypeOf(file),
      ]).pipe(
        Effect.filterOrFail(
          ({ exitCode }) => exitCode === 0,
          ({ output }) =>
            failed(
              "upload",
              `wrangler r2 object put ${bucket}/${key} failed:\n${output.trim()}`
            )
        )
      );

      yield* Console.log(`  uploaded ${bucket}/${key}`);
    }

    return manifest;
  }).pipe(Effect.scoped);

export const missingFromPackage = (layout: Layout, version: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const manifest = publishManifest(Brand, { dependencies: {}, version });

    return yield* Effect.filter(namedFiles(manifest), (file) =>
      Effect.map(fs.exists(path.join(layout.npm, file)), (exists) => !exists)
    );
  });

export const publishable = (layout: Layout, release: Release) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;

    yield* readPackage("publish", path.join(layout.npm, "package.json")).pipe(
      Effect.filterOrFail(
        ({ version }) => version === release.version,
        ({ version }) =>
          failed(
            "publish",
            `the staged package is ${version ?? "unversioned"}, not ${release.version}: run --build --version ${release.version} first`
          )
      )
    );

    yield* missingFromPackage(layout, release.version).pipe(
      Effect.filterOrFail(
        (missing) => missing.length === 0,
        (missing) =>
          failed("publish", `the staged package lacks ${missing.join(", ")}`)
      )
    );

    const stage = yield* Effect.fromOption(release.stage).pipe(
      Effect.mapError(() => failed("publish", "a publish names its --stage"))
    );

    const scratch = yield* FileSystem.FileSystem.pipe(
      Effect.flatMap((fs) => fs.makeTempDirectoryScoped({ prefix: "release-" }))
    );

    const manifest = yield* bucketManifest(
      "publish",
      layout,
      resources(stage).releases,
      scratch
    );

    yield* Effect.fromResult(
      servedAsLatest({
        manifest: Option.getOrUndefined(manifest),
        version: release.version,
      })
    ).pipe(Effect.mapError(({ message }) => failed("publish", message)));
  }).pipe(Effect.scoped);

const publish = (layout: Layout, release: Release) =>
  Effect.andThen(
    publishable(layout, release),
    run(
      "publish",
      "npm",
      ["publish", layout.npm, "--access", "public"],
      layout.root
    )
  );

const writeInstallScript = (layout: Layout, release: Release) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    yield* fs.makeDirectory(layout.release, { recursive: true });

    yield* fs.writeFileString(
      path.join(layout.release, "install.sh"),
      installScript({
        baseUrl: `${release.origin}/releases/${release.version}`,
        brand: Brand,
        version: release.version,
      })
    );

    yield* fs.chmod(path.join(layout.release, "install.sh"), 0o755);
  });

export const runStep = (step: ReleaseStep, layout: Layout, release: Release) =>
  Match.value(step).pipe(
    Match.when("tsdown", () =>
      run(
        "tsdown",
        "bun",
        [
          "run",
          "build",
          "--",
          "--targets",
          targets.join(","),
          "--version",
          release.version,
        ],
        layout.cli
      )
    ),
    Match.when("manifest", () => stagePackage(layout, release)),
    Match.when("copySkills", () => writeSkills(layout)),
    Match.when("compile", () => collectBinaries(layout)),
    Match.when("installScript", () => writeInstallScript(layout, release)),
    Match.when("checksums", () => writeChecksums(layout)),
    Match.when("upload", () => upload(layout, release)),
    Match.when("publish", () => publish(layout, release)),
    Match.exhaustive
  );
