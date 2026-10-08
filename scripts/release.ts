/**
 * release: builds the CLI into its npm package and two single-file
 * binaries, uploads a release to a stage's own release storage, and
 * publishes the package only when a person runs it (issue 715).
 *
 *   bun run release -- --build [--version <semver>] [--stage <s> | --origin <url>]
 *   bun run release -- --upload --stage dev-oscabriel|demo --version <semver>
 *   bun run release -- --publish --version <semver>
 *
 * `--build` runs 416's build with both targets, stages the npm package in
 * `apps/cli/release/npm/` (its `package.json` generated from `Brand`, the
 * platform's skill, a README and the licence), copies the binaries to
 * `apps/cli/release/<slug>-<target>`, and writes `install.sh` and
 * `SHA256SUMS` beside them. The install script fetches from `--origin`, or
 * the stage's platform origin, or the local platform (`wrangler dev`).
 *
 * `--upload --stage <s>` puts the version's files into the stage's
 * `releases-<stage>` bucket with Wrangler's own login, and
 * `releases/manifest.json` last; the platform then serves `<origin>/install.sh`
 * and `<origin>/releases/…` (issue 420). Nothing goes to GitHub.
 *
 * `--publish` runs `npm publish` only when a person runs it: under any
 * agent's env (`@repo/protocol/audit`'s table) it does nothing, prints the
 * command for a person to run, and exits 0 (H2). The release's core lives
 * in `lib/release.ts`, its steps in `lib/release/steps.ts`.
 */
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
import { releasePlan, releaseVersion } from "./lib/release.ts";
import {
  layoutOf,
  missingFromPackage,
  publishCommand,
  ReleaseFailed,
  runStep,
} from "./lib/release/steps.ts";
import type { Layout, Release } from "./lib/release/steps.ts";

/** The flags the command takes; any other is a typo, refused. */
const FLAGS = new Set([
  "--build",
  "--origin",
  "--publish",
  "--stage",
  "--upload",
  "--version",
]);

const USAGE =
  "bun run release -- [--build] [--upload --stage <dev-…|demo>] [--publish] [--version <semver>] [--origin <url>]";

/**
 * The release stopped, and it has said why in one line: what failed and
 * what to do (a step's failure, a refusal of the flags or the plan). The
 * runtime then exits 1 without printing it again.
 */
class Reported extends Schema.TaggedError<Reported>()("Reported", {}) {
  override readonly [Runtime.errorReported] = false;
}

/** The local platform, as `wrangler dev` serves it. */
const LOCAL_ORIGIN = "http://localhost:8787";

/** What `bun run release` was asked to do. */
interface Options {
  readonly build: boolean;
  readonly upload: boolean;
  readonly publish: boolean;
  readonly stage?: string;
  readonly version?: string;
  readonly origin?: string;
}

/** The command's flags, read; an unknown flag or no step at all is refused. */
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

/** The stage's platform origin, on the workers.dev subdomain bootstrap recorded. */
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

/** Sizes of the release folder's files, and the staged package's files, for the record. */
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

/**
 * Under an agent, `--publish` does nothing but say what a person runs
 * (H2), and the run ends well: the agent has done all it may.
 */
const handOver = (markers: readonly string[]) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const layout = yield* layoutOf(yield* repoRoot);

    yield* Console.log(
      [
        `release: an agent runs this (${markers.join(", ")}), so it publishes nothing (H2).`,
        "A person publishes the staged package, after `npm login`, from the repo root:",
        "",
        `  ${publishCommand(layout, path)}`,
      ].join("\n")
    );
  });

export const main = (argv: readonly string[]) =>
  Effect.gen(function* () {
    const options = yield* optionsOf(argv);
    const root = yield* repoRoot;
    const layout = yield* layoutOf(root);

    // The env as this process got it: an agent's harness marks it there.
    const steps = yield* Effect.fromResult(
      releasePlan({ ...options, env: process.env })
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

    yield* Console.log(
      `release ${version}: ${steps.join(", ")} (the install script fetches from ${origin})`
    );

    for (const step of steps) {
      yield* Console.log(`release: ${step}`);
      yield* runStep(step, layout, release);
    }

    yield* report(layout, version);
  }).pipe(
    Effect.catchTag("PublishNeedsAPerson", ({ markers }) => handOver(markers)),
    Effect.tapError((failure) => Console.error(`release: ${failure.message}`)),
    Effect.mapError(() => new Reported())
  );

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const args = yield* (yield* Stdio.Stdio).args;

      return yield* main(args);
    }).pipe(Effect.provide(BunServices.layer))
  );
}
