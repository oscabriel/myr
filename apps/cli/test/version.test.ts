/**
 * The CLI's version: `src/version.ts` says it, a run no build stamped says
 * `0.0.0`, and `build.ts` stamps a release's version into both bundlers'
 * output through one define. The real build compiles binaries, so it is
 * run by hand (issue 1104's comments), not here.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client } from "@repo/protocol/contracts";
import { Effect, FileSystem, Layer, Option, Path, Ref, Schema } from "effect";
import { CliOutput } from "effect/cli";
import { TestConsole } from "effect/testing";
import { build } from "tsdown";

import { compileArgs, parseBuild, versionDefine } from "../build.ts";
import type { BuildOptions } from "../build.ts";
import { program } from "../src/main.ts";
import { OutputPlain } from "../src/output.ts";
import { cliVersion } from "../src/version.ts";
import { npm } from "../tsdown.config.ts";
import { SignedOut } from "./signed-out.ts";

const services = Layer.mergeAll(
  TestConsole.layer,
  CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
  Layer.mock(Client)({}),
  OutputPlain,
  SignedOut
).pipe(Layer.provideMerge(NodeServices.layer));

/** What a built `version.ts` exports. */
const Built = Schema.Struct({ cliVersion: Schema.String });

describe("the CLI's version, unbuilt", () => {
  it.effect("is 0.0.0, and --version prints it", () =>
    Effect.gen(function* () {
      yield* program(["--version"]);

      expect({
        cliVersion,
        printed: (yield* TestConsole.logLines).map(String),
      }).toStrictEqual({
        cliVersion: "0.0.0",
        printed: [`${Brand.cli} v0.0.0`],
      });
    }).pipe(Effect.provide(services))
  );
});

describe("the build's version stamp", () => {
  it.effect(
    "replaces the expression version.ts reads with the version, as a string literal",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* path.fromFileUrl(new URL("..", import.meta.url));

        const source = yield* fs.readFileString(
          path.join(root, "src", "version.ts")
        );

        const define = versionDefine("9.9.9-test");

        expect({
          define,
          unread: Object.keys(define).filter((key) => !source.includes(key)),
        }).toStrictEqual({
          define: { "import.meta.env.CLI_BUILD_VERSION": '"9.9.9-test"' },
          unread: [],
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it("is in every config tsdown.config.ts makes, for the version it is given", () => {
    expect(npm("9.9.9-test").map((config) => config.define)).toStrictEqual(
      Array.from({ length: 3 }, () => versionDefine("9.9.9-test"))
    );
  });

  it.live(
    "stamps the npm build: tsdown's build of version.ts reads the version",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* path.fromFileUrl(new URL("..", import.meta.url));

        const out = yield* fs.makeTempDirectoryScoped({
          prefix: "cli-version-",
        });

        const [first] = npm("9.9.9-test");

        yield* Effect.tryPromise(() =>
          build({
            ...first,
            config: false,
            cwd: root,
            entry: { version: path.join(root, "src", "version.ts") },
            logLevel: "silent",
            outDir: out,
          })
        );

        const built = yield* Effect.tryPromise(
          () => import(path.join(out, "version.js"))
        ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Built)));

        expect(built.cliVersion).toBe("9.9.9-test");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it("stamps each compiled binary with the same define", () => {
    expect(
      compileArgs({
        entry: "/b/main.ts",
        outfile: "/b/out",
        target: "linux-x64",
        version: "9.9.9-test",
      })
    ).toStrictEqual([
      "build",
      "--compile",
      "--minify",
      "--define",
      'import.meta.env.CLI_BUILD_VERSION="9.9.9-test"',
      "--target=bun-linux-x64",
      "/b/main.ts",
      "--outfile",
      "/b/out",
    ]);
  });
});

/** What the build would run with for `argv`, if it would run. */
const parsed = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const seen = yield* Ref.make(Option.none<BuildOptions>());

    yield* parseBuild(argv, (options) => Ref.set(seen, Option.some(options)));

    return yield* Ref.get(seen);
  }).pipe(Effect.provide(services));

describe("the build's flags", () => {
  it.effect(
    "read --version and --targets, and build 0.0.0 without a version",
    () =>
      Effect.gen(function* () {
        expect({
          stamped: yield* parsed([
            "--targets",
            "bun-linux-x64,darwin-arm64",
            "--version",
            "9.9.9-test",
          ]),
          unstamped: yield* parsed([]),
        }).toStrictEqual({
          stamped: Option.some({
            targets: ["linux-x64", "darwin-arm64"],
            version: "9.9.9-test",
          }),
          unstamped: Option.some({ targets: [], version: "0.0.0" }),
        });
      })
  );
});
