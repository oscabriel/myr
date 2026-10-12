import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  Array as Arr,
  Crypto,
  Effect,
  FileSystem,
  Layer,
  Option,
  Order,
  Path,
  Ref,
  Result,
  Schema,
  Sink,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { ReleaseManifest } from "../../../apps/platform/src/releases.ts";
import { NoStage, UnknownStage } from "../../../infra/stages.ts";
import {
  agentMarkers,
  checksumsFile,
  importedPackages,
  installScript,
  namedFiles,
  pinnedDependencies,
  publishManifest,
  PublishNeedsAPerson,
  releaseManifest,
  releasePlan,
  releaseRun,
  releaseVersion,
  targets,
  Unpinned,
  unreleased,
  uploads,
  VersionNeeded,
  VersionReleased,
} from "../../../scripts/lib/release.ts";
import { layoutOf, runStep } from "../../../scripts/lib/release/steps.ts";
import { Brand } from "../../brand/src/index.ts";
import { repoRoot } from "./root.ts";

const PackageJson = Schema.fromJsonString(
  Schema.Struct({
    dependencies: Schema.optionalKey(
      Schema.Record(Schema.String, Schema.String)
    ),
    workspaces: Schema.optionalKey(
      Schema.Struct({
        catalog: Schema.optionalKey(
          Schema.Record(Schema.String, Schema.String)
        ),
      })
    ),
  })
);

const runtime = { "@effect/platform-bun": "4.0.1", effect: "4.0.1" };

describe("the npm package's manifest", () => {
  const manifest = publishManifest(Brand, {
    dependencies: runtime,
    version: "0.1.0",
  });

  it("is the brand's CLI package, with both names as bins", () => {
    expect({
      bin: manifest.bin,
      license: manifest.license,
      name: manifest.name,
      version: manifest.version,
    }).toStrictEqual({
      bin: {
        [Brand.cli]: "./dist/bin.js",
        [Brand.gitCredentialHelper]: "./dist/bin.js",
      },
      license: "MIT",
      name: Brand.cliPackage,
      version: "0.1.0",
    });
  });

  it("exports the command line, the sdk a config folder imports, and its types", () => {
    expect(manifest.exports).toStrictEqual({
      ".": "./dist/bin.js",
      "./protocol": {
        default: "./dist/protocol.js",
        types: "./dist/protocol.d.ts",
      },
      "./rules": { default: "./dist/rules.js", types: "./dist/rules.d.ts" },
    });
  });

  it("lists each library entry's types first and its code last, the order Node and TypeScript match conditions in", () => {
    expect(
      [manifest.exports["./rules"], manifest.exports["./protocol"]].map(
        (entry) => Object.keys(entry ?? {})
      )
    ).toStrictEqual([
      ["types", "default"],
      ["types", "default"],
    ]);
  });

  it("is a pi package whose host is an optional peer, never a dependency", () => {
    expect({
      dependencies: manifest.dependencies,
      keywords: manifest.keywords.includes("pi-package"),
      peerDependencies: manifest.peerDependencies,
      peerDependenciesMeta: manifest.peerDependenciesMeta,
      pi: manifest.pi,
    }).toStrictEqual({
      dependencies: runtime,
      keywords: true,
      peerDependencies: { "@earendil-works/pi-coding-agent": "*" },
      peerDependenciesMeta: {
        "@earendil-works/pi-coding-agent": { optional: true },
      },
      pi: { extensions: ["./dist/pi.js"], skills: ["./skills"] },
    });
  });

  it("ships the build, the platform's skill, a README and the licence", () => {
    expect(manifest.files).toStrictEqual([
      "dist/",
      "skills/",
      "README.md",
      "LICENSE",
    ]);
  });
});

/** The top of a tsdown build, as rolldown writes it, with prose that only looks like imports. */
const built = [
  "#!/usr/bin/env node",
  'import { createRequire } from "node:module";',
  'import { BunRuntime, BunServices } from "@effect/platform-bun";',
  'import { Effect, Schema } from "effect";',
  'import { Command, Flag } from "effect/cli";',
  'import "./chunk-a1.js";',
  "/**",
  ' * `import("x")` and `require("x")`, and `… from "y"`.',
  " */",
  'const source = `import { project } from "some-sdk/rules";`;',
  "",
].join("\n");

describe("the npm package's dependencies", () => {
  it("are the packages the build imports, by package name", () => {
    expect(importedPackages(built)).toStrictEqual([
      "@effect/platform-bun",
      "effect",
    ]);
  });

  it.live(
    "are pinned from the CLI's own manifest and the catalog, with no workspace package",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* repoRoot;

        const read = (file: string) =>
          fs
            .readFileString(path.join(root, file))
            .pipe(Effect.flatMap(Schema.decodeEffect(PackageJson)));

        const cli = yield* read("apps/cli/package.json");
        const workspace = yield* read("package.json");

        const pinned = pinnedDependencies({
          catalog: workspace.workspaces?.catalog ?? {},
          declared: cli.dependencies ?? {},
          imported: importedPackages(built),
        });

        expect(
          Result.map(pinned, (dependencies) => ({
            exact: Object.values(dependencies).every((version) =>
              /^\d+\.\d+\.\d+$/u.test(version)
            ),
            names: Object.keys(dependencies),
          }))
        ).toStrictEqual(
          Result.succeed({
            exact: true,
            names: ["@effect/platform-bun", "effect"],
          })
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it("refuses a package the build imports that the CLI doesn't declare, or one from the workspace", () => {
    expect(
      pinnedDependencies({
        catalog: { effect: "4.0.1" },
        declared: { "@repo/brand": "workspace:*", effect: "catalog:" },
        imported: ["@repo/brand", "effect", "yaml"],
      })
    ).toStrictEqual(
      Result.fail(new Unpinned({ packages: ["@repo/brand", "yaml"] }))
    );
  });

  it("leave out pi, which the pi adapter imports from its host, never from a dependency", () => {
    expect(
      pinnedDependencies({
        catalog: { effect: "4.0.1" },
        declared: { effect: "catalog:" },
        imported: ["@earendil-works/pi-coding-agent", "effect"],
      })
    ).toStrictEqual(Result.succeed({ effect: "4.0.1" }));
  });
});

describe("a release's plan", () => {
  it("builds for exactly linux-x64 and darwin-arm64", () => {
    expect(targets).toStrictEqual(["bun-linux-x64", "bun-darwin-arm64"]);
  });

  it("reads an agent from any harness's marker in the env, and nothing else", () => {
    expect({
      agent: agentMarkers({
        AI_AGENT: "",
        CLAUDECODE: "1",
        HOME: "/home/someone",
        PI_SESSION_ID: "s1",
      }),
      person: agentMarkers({ HOME: "/home/someone", PATH: "/usr/bin" }),
    }).toStrictEqual({ agent: ["CLAUDECODE", "PI_SESSION_ID"], person: [] });
  });

  it("refuses to publish under an agent, naming what marked it", () => {
    expect(
      releasePlan({
        build: false,
        env: { CLAUDECODE: "1" },
        publish: true,
        upload: false,
      })
    ).toStrictEqual(
      Result.fail(new PublishNeedsAPerson({ markers: ["CLAUDECODE"] }))
    );
  });

  it("under an agent, still runs every other step it was asked for, and hands only the publish to a person", () => {
    expect({
      agent: releaseRun({
        build: true,
        env: { CLAUDECODE: "1" },
        publish: true,
        stage: "demo",
        upload: true,
      }),
      alone: releaseRun({
        build: false,
        env: { CLAUDECODE: "1" },
        publish: true,
        upload: false,
      }),
      person: releaseRun({
        build: false,
        env: {},
        publish: true,
        upload: false,
      }),
    }).toStrictEqual({
      agent: Result.succeed({
        handOver: ["CLAUDECODE"],
        steps: [
          "tsdown",
          "manifest",
          "copySkills",
          "compile",
          "installScript",
          "checksums",
          "upload",
        ],
      }),
      alone: Result.succeed({ handOver: ["CLAUDECODE"], steps: [] }),
      person: Result.succeed({ handOver: [], steps: ["publish"] }),
    });
  });

  it("refuses an unknown stage under an agent too, before it hands anything over", () => {
    expect(
      releaseRun({
        build: false,
        env: { CLAUDECODE: "1" },
        publish: true,
        stage: "prod",
        upload: true,
      })
    ).toStrictEqual(Result.fail(new UnknownStage({ stage: "prod" })));
  });

  it("publishes last when a person runs it", () => {
    expect(
      Result.map(
        releasePlan({ build: false, env: {}, publish: true, upload: false }),
        Arr.last
      )
    ).toStrictEqual(Result.succeed(Option.some("publish")));
  });

  it("builds the package and the binaries, and writes the install script and checksums", () => {
    expect(
      releasePlan({ build: true, env: {}, publish: false, upload: false })
    ).toStrictEqual(
      Result.succeed([
        "tsdown",
        "manifest",
        "copySkills",
        "compile",
        "installScript",
        "checksums",
      ])
    );
  });

  it("uploads to a stage's own release storage after the checksums", () => {
    expect(
      releasePlan({
        build: true,
        env: {},
        publish: true,
        stage: "demo",
        upload: true,
      })
    ).toStrictEqual(
      Result.succeed([
        "tsdown",
        "manifest",
        "copySkills",
        "compile",
        "installScript",
        "checksums",
        "upload",
        "publish",
      ])
    );
  });

  it("uploads what was built, for the stage's own origin", () => {
    expect(
      releasePlan({
        build: false,
        env: { CLAUDECODE: "1" },
        publish: false,
        stage: "dev-oscabriel",
        upload: true,
      })
    ).toStrictEqual(Result.succeed(["installScript", "checksums", "upload"]));
  });

  it("names its version when it uploads or publishes, and only a version the platform serves", () => {
    expect({
      build: releaseVersion({ publish: false, upload: false }),
      named: releaseVersion({
        publish: true,
        upload: true,
        version: "0.2.0-rc.1",
      }),
      unnamed: releaseVersion({ publish: false, upload: true }),
      wrong: releaseVersion({
        publish: false,
        upload: true,
        version: "latest",
      }),
    }).toStrictEqual({
      build: Result.succeed("0.0.0"),
      named: Result.succeed("0.2.0-rc.1"),
      unnamed: Result.fail(new VersionNeeded({})),
      wrong: Result.fail(new VersionNeeded({ given: "latest" })),
    });
  });

  it("refuses an upload to a stage the repo doesn't declare, or to none", () => {
    expect({
      none: releasePlan({
        build: false,
        env: {},
        publish: false,
        upload: true,
      }),
      unknown: releasePlan({
        build: false,
        env: {},
        publish: false,
        stage: "prod",
        upload: true,
      }),
    }).toStrictEqual({
      none: Result.fail(new NoStage()),
      unknown: Result.fail(new UnknownStage({ stage: "prod" })),
    });
  });
});

const digest = (fill: string) => fill.repeat(64);

const first = {
  latest: "0.1.0",
  versions: {
    "0.1.0": {
      assets: {
        [`${Brand.slug}-darwin-arm64`]: {
          bytes: 62_722_290,
          sha256: digest("a"),
        },
        [`${Brand.slug}-linux-x64`]: { bytes: 81_806_816, sha256: digest("b") },
      },
    },
  },
};

const second = {
  "install.sh": { bytes: 2048, sha256: digest("c") },
  [`${Brand.slug}-darwin-arm64`]: { bytes: 62_800_000, sha256: digest("d") },
  [`${Brand.slug}-linux-x64`]: { bytes: 81_900_000, sha256: digest("e") },
};

const recordingSpawner = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* repoRoot;
  const lines = yield* Ref.make<readonly string[]>([]);

  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      if (!ChildProcess.isStandardCommand(command)) {
        return yield* Effect.die("the release pipes no commands");
      }

      yield* Ref.update(lines, (all) => [
        ...all,
        `${path.relative(root, command.options.cwd ?? root)}$ ${[command.command, ...command.args].join(" ")}`,
      ]);

      return ChildProcessSpawner.makeHandle({
        all: Stream.empty,
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        pid: ChildProcessSpawner.ProcessId(1),
        stderr: Stream.empty,
        stdin: Sink.drain,
        stdout: Stream.empty,
        unref: Effect.succeed(Effect.void),
      });
    })
  );

  return {
    layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    spawned: Ref.get(lines),
  };
});

describe("a release's build step", () => {
  it.effect(
    "builds the CLI stamped with the release's version, for both targets",
    () =>
      Effect.gen(function* () {
        const { layer, spawned } = yield* recordingSpawner;
        const layout = yield* layoutOf(yield* repoRoot);

        yield* runStep("tsdown", layout, {
          origin: "https://platform.example",
          stage: Option.none(),
          version: "0.2.0-demo.1",
        }).pipe(Effect.provide(layer));

        expect(yield* spawned).toStrictEqual([
          "apps/cli$ bun run build -- --targets bun-linux-x64,bun-darwin-arm64 --version 0.2.0-demo.1",
        ]);
      }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("the release manifest", () => {
  it.effect(
    "keeps every earlier version, makes the new one latest, and is what the platform decodes",
    () =>
      Effect.gen(function* () {
        const manifest = releaseManifest({
          assets: second,
          previous: first,
          version: "0.2.0",
        });

        expect(
          yield* Schema.decodeEffect(ReleaseManifest)(manifest)
        ).toStrictEqual({
          latest: "0.2.0",
          versions: { ...first.versions, "0.2.0": { assets: second } },
        });
      })
  );

  it("starts the list with the first release", () => {
    expect(
      releaseManifest({ assets: second, previous: undefined, version: "0.1.0" })
    ).toStrictEqual({
      latest: "0.1.0",
      versions: { "0.1.0": { assets: second } },
    });
  });

  it("refuses to release a version again with other bytes, since its files are cached for good", () => {
    expect({
      again: unreleased({
        assets: first.versions["0.1.0"].assets,
        previous: first,
        version: "0.1.0",
      }),
      changed: unreleased({
        assets: second,
        previous: first,
        version: "0.1.0",
      }),
      next: unreleased({ assets: second, previous: first, version: "0.2.0" }),
    }).toStrictEqual({
      again: Result.void,
      changed: Result.fail(new VersionReleased({ version: "0.1.0" })),
      next: Result.void,
    });
  });
});

const sha256 = (content: string) =>
  Effect.flatMap(Crypto.Crypto, (crypto) =>
    crypto.digest("SHA-256", new TextEncoder().encode(content))
  ).pipe(
    Effect.map((bytes) =>
      [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
    ),
    Effect.provide(NodeServices.layer)
  );

const origin = "https://platform-demo.example.workers.dev";

const base = `${origin}/releases/0.1.0`;

describe("the install script", () => {
  const script = installScript({
    baseUrl: base,
    brand: Brand,
    version: "0.1.0",
  });

  it("fetches the release and its checksums from the platform, and never from GitHub", () => {
    expect({
      base: script.includes(`'${base}'`),
      checksums: script.includes('"$base/SHA256SUMS"'),
      github: /github/iu.test(script),
      posix: script.startsWith("#!/bin/sh\n"),
    }).toStrictEqual({
      base: true,
      checksums: true,
      github: false,
      posix: true,
    });
  });

  const install = (files: Readonly<Record<string, string>>) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "install-715-" });
      const served = path.join(dir, "served");
      const tools = path.join(dir, "tools");
      const home = path.join(dir, "home");

      yield* Effect.forEach([served, tools, home], (folder) =>
        fs.makeDirectory(folder, { recursive: true })
      );

      yield* Effect.forEach(Object.entries(files), ([name, content]) =>
        fs.writeFileString(path.join(served, name), content)
      );

      yield* fs.writeFileString(
        path.join(tools, "curl"),
        [
          "#!/bin/sh",
          'out=""; url=""',
          "while [ $# -gt 0 ]; do",
          '  case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac',
          "done",
          'case "$url" in "$RELEASE_BASE"/*) ;; *) exit 22 ;; esac',
          'name="$(basename "$url")"',
          '[ -f "$SERVED/$name" ] || exit 22',
          'cp "$SERVED/$name" "$out"',
          "",
        ].join("\n")
      );

      yield* fs.chmod(path.join(tools, "curl"), 0o755);
      yield* fs.writeFileString(path.join(dir, "install.sh"), script);

      const child = yield* spawner.spawn(
        ChildProcess.make("sh", [path.join(dir, "install.sh")], {
          env: {
            HOME: home,
            PATH: `${tools}:/usr/bin:/bin`,
            RELEASE_BASE: base,
            SERVED: served,
          },
          extendEnv: false,
        })
      );

      const [stderr, exitCode] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(child.stderr)), child.exitCode],
        { concurrency: "unbounded" }
      );

      const bin = path.join(home, ".local", "bin");

      const installed = (yield* fs.exists(bin))
        ? Arr.sort(yield* fs.readDirectory(bin), Order.String)
        : [];

      return {
        exitCode: Number(exitCode),
        helper: installed.includes(Brand.gitCredentialHelper)
          ? yield* fs.readLink(path.join(bin, Brand.gitCredentialHelper))
          : "",
        installed,
        stderr,
      };
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

  const binaries = Object.fromEntries(
    ["linux-x64", "darwin-arm64"].map((target) => [
      `${Brand.slug}-${target}`,
      `#!/bin/sh\necho ${target}\n`,
    ])
  );

  const sums = <E, R>(
    digestOf: (content: string) => Effect.Effect<string, E, R>
  ) =>
    Effect.map(
      Effect.forEach(Object.entries(binaries), ([name, content]) =>
        Effect.map(digestOf(content), (sum) => `${sum}  ${name}\n`)
      ),
      (lines) => lines.join("")
    );

  it.live(
    "installs the binary that matches SHA256SUMS, with git's credential helper beside it",
    () =>
      Effect.gen(function* () {
        const ran = yield* install({
          ...binaries,
          SHA256SUMS: yield* sums(sha256),
        });

        expect({ ...ran, stderr: ran.stderr.trim() }).toStrictEqual({
          exitCode: 0,
          helper: Brand.cli,
          installed: Arr.sort(
            [Brand.cli, Brand.gitCredentialHelper],
            Order.String
          ),
          stderr: "",
        });
      })
  );

  it.live("installs nothing when the download doesn't match SHA256SUMS", () =>
    Effect.gen(function* () {
      const ran = yield* install({
        ...binaries,
        SHA256SUMS: yield* sums(() => Effect.succeed(digest("0"))),
      });

      expect({
        exitCode: ran.exitCode,
        installed: ran.installed,
        said: ran.stderr.includes("does not match SHA256SUMS"),
      }).toStrictEqual({ exitCode: 1, installed: [], said: true });
    })
  );
});

describe("what a release hands the platform", () => {
  it("lists each file's digest as sha256sum does, sorted by name", () => {
    expect(checksumsFile(second)).toStrictEqual(
      [
        `${digest("c")}  install.sh`,
        `${digest("d")}  ${Brand.slug}-darwin-arm64`,
        `${digest("e")}  ${Brand.slug}-linux-x64`,
        "",
      ].join("\n")
    );
  });

  it("uploads every file of the version first and the manifest last, so it never names a missing file", () => {
    expect(
      uploads({ files: Object.keys(second), version: "0.2.0" })
    ).toStrictEqual([
      { file: "install.sh", key: "releases/0.2.0/install.sh" },
      {
        file: `${Brand.slug}-darwin-arm64`,
        key: `releases/0.2.0/${Brand.slug}-darwin-arm64`,
      },
      {
        file: `${Brand.slug}-linux-x64`,
        key: `releases/0.2.0/${Brand.slug}-linux-x64`,
      },
      { file: "manifest.json", key: "releases/manifest.json" },
    ]);
  });

  it("names every file the npm package's manifest points at, so a package missing one is never published", () => {
    expect(
      namedFiles(
        publishManifest(Brand, { dependencies: runtime, version: "0.1.0" })
      )
    ).toStrictEqual([
      "LICENSE",
      "README.md",
      "dist/bin.js",
      "dist/pi.js",
      "dist/protocol.d.ts",
      "dist/protocol.js",
      "dist/rules.d.ts",
      "dist/rules.js",
      "skills",
    ]);
  });
});
