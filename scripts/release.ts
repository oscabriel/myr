import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  Runtime,
  Schema,
  Stdio,
} from "effect";

import {
  declaredStage,
  flagValue,
  platformOrigin,
  repoRoot,
  subdomainFile,
  WorkersDev,
} from "../infra/stages.ts";
import type { Stage } from "../infra/stages.ts";
import { releaseRun, releaseVersion } from "./lib/release.ts";
import {
  layoutOf,
  missingFromPackage,
  publishable,
  publishCommand,
  ReleaseFailed,
  runStep,
} from "./lib/release/steps.ts";
import type { Layout, Release } from "./lib/release/steps.ts";

const FLAGS = new Set([
  "--build",
  "--origin",
  "--publish",
  "--stage",
  "--upload",
  "--version",
]);

const USAGE =
  "bun run release -- [--build] [--upload] [--publish] [--stage <dev-…|prod>] [--version <semver>] [--origin <url>]";

// Already said in one line, so the runtime exits 1 without printing it again.
class Reported extends Schema.TaggedError<Reported>()("Reported", {}) {
  override readonly [Runtime.errorReported] = false;
}

const LOCAL_ORIGIN = "http://localhost:8787";

interface Options {
  readonly build: boolean;
  readonly upload: boolean;
  readonly publish: boolean;
  readonly stage?: string;
  readonly version?: string;
  readonly origin?: string;
}

const optionsOf = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const unknown = argv.filter(
      (arg) => arg.startsWith("--") && !FLAGS.has(arg.split("=")[0] ?? arg)
    );

    if (unknown.length > 0) {
      return yield* new ReleaseFailed({
        reason: `unknown ${unknown.join(", ")}; usage: ${USAGE}`,
        step: "flags",
      });
    }

    const options: Options = {
      build: argv.includes("--build"),
      publish: argv.includes("--publish"),
      upload: argv.includes("--upload"),
      ...Option.match(flagValue(argv, "--stage"), {
        onNone: () => ({}),
        onSome: (stage) => ({ stage }),
      }),
      ...Option.match(flagValue(argv, "--version"), {
        onNone: () => ({}),
        onSome: (version) => ({ version }),
      }),
      ...Option.match(flagValue(argv, "--origin"), {
        onNone: () => ({}),
        onSome: (origin) => ({ origin: origin.replace(/\/+$/u, "") }),
      }),
    };

    if (!options.build && !options.upload && !options.publish) {
      return yield* new ReleaseFailed({
        reason: `name a step; usage: ${USAGE}`,
        step: "flags",
      });
    }

    return options;
  });

const stageOrigin = (root: string, stage: Stage) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const { subdomain } = yield* fs
      .readFileString(path.join(root, subdomainFile))
      .pipe(
        Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(WorkersDev))),
        Effect.mapError(
          () =>
            new ReleaseFailed({
              reason: `${subdomainFile} names no workers.dev subdomain: run bootstrap, or pass --origin`,
              step: "installScript",
            })
        )
      );

    return platformOrigin(stage, subdomain);
  });

const report = (layout: Layout, version: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    if (!(yield* fs.exists(layout.release))) {
      return;
    }

    for (const name of (yield* fs.readDirectory(layout.release)).toSorted()) {
      const info = yield* fs.stat(path.join(layout.release, name));

      if (info.type === "File") {
        yield* Console.log(
          `  ${path.relative(layout.root, path.join(layout.release, name))}  ${Number(info.size).toLocaleString("en-US")} bytes`
        );
      }
    }

    if (yield* fs.exists(layout.npm)) {
      const files = (yield* fs.readDirectory(layout.npm, {
        recursive: true,
      })).toSorted();

      yield* Console.log(
        `  ${path.relative(layout.root, layout.npm)}/: ${files.join(", ")}`
      );

      const missing = yield* missingFromPackage(layout, version);

      if (missing.length > 0) {
        yield* Console.log(
          `  the package lacks ${missing.join(", ")}, which its manifest names: --publish refuses it until the build makes ${missing.length === 1 ? "that file" : "them"}`
        );
      }
    }
  });

// Under an agent, the publish is a person's: say what they run, and end well.
const handOver = (
  layout: Layout,
  release: Release,
  markers: readonly string[]
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;

    yield* publishable(layout, release);

    yield* Console.log(
      [
        `release: an agent runs this (${markers.join(", ")}), so it doesn't publish (H2).`,
        `A person publishes the staged package (${release.version}), after \`npm login\`, from the repo root:`,
        "",
        `  ${publishCommand(layout, path)}`,
      ].join("\n")
    );
  });

export const main = (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
) =>
  Effect.gen(function* () {
    const options = yield* optionsOf(argv);
    const root = yield* repoRoot;
    const layout = yield* layoutOf(root);

    const { handOver: markers, steps } = yield* Effect.fromResult(
      releaseRun({ ...options, env })
    );

    const version = yield* Effect.fromResult(releaseVersion(options));

    const stage = Option.flatMap(
      Option.fromNullishOr(options.stage),
      declaredStage
    );

    const origin =
      options.origin ??
      (yield* Option.match(stage, {
        onNone: () => Effect.succeed(LOCAL_ORIGIN),
        onSome: (named) => stageOrigin(root, named),
      }));

    const release: Release = { origin, stage, version };

    const planned = [
      ...steps,
      ...(markers.length > 0 ? ["publish (by a person)"] : []),
    ];

    yield* Console.log(
      `release ${version}: ${planned.join(", ")} (the install script fetches from ${origin})`
    );

    for (const step of steps) {
      yield* Console.log(`release: ${step}`);
      yield* runStep(step, layout, release);
    }

    yield* report(layout, version);

    if (markers.length > 0) {
      yield* handOver(layout, release, markers);
    }
  }).pipe(
    Effect.tapError((failure) => Console.error(`release: ${failure.message}`)),
    Effect.mapError(() => new Reported())
  );

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const args = yield* (yield* Stdio.Stdio).args;

      // The env as this process got it: an agent's harness marks it there.
      return yield* main(args, process.env);
    }).pipe(Effect.provide(BunServices.layer))
  );
}
