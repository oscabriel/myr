/**
 * The core loop's world (`world.ts`) as a process of its own:
 * `bun apps/platform/test/serve-world.ts` serves the platform's fetch
 * handler on a local port, composed as the Worker composes it, and prints
 * one JSON line, `{"origin":"http://127.0.0.1:<port>"}`, once it serves. It
 * serves until its stdin ends (the process that started it closed it, or
 * died) or it is told to stop.
 *
 * Two things differ from the world a test builds in process:
 *
 * - The Checker runs each lane for real, under `sh -c`, in a clone of the
 *   commit or tree it is given (`CheckRunnerLocal`), so an ask's check is
 *   red first, or not, by what it really does.
 * - Beside dora, alice and bob, the people in `WORLD_SESSIONS` (a JSON
 *   object from token to handle, as `SESSION_TOKENS` is) may call.
 *
 * The seed's `--world node` runs it (W5 509, `scripts/lib/seed.ts`) and
 * reaches it over HTTP and git, as it reaches a stage. A process, not an
 * import: apps never import apps, and no file outside the platform imports
 * its test world. The Worker's modules import `cloudflare:workers`, which
 * this file serves from `workers-shim.ts` through Bun's runtime plugins,
 * before it loads them, as vitest's alias does for the platform's tests.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { CheckRunner, shaOf } from "@repo/checks/check-runner";
import type { CheckAt } from "@repo/checks/check-runner";
import { CheckRunnerLocal } from "@repo/checks/check-runner/local";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { git } from "@repo/testkit/git";
import {
  Config,
  Console,
  Effect,
  FileSystem,
  Layer,
  Schema,
  Stdio,
  Stream,
} from "effect";

import * as shim from "./workers-shim.ts";

/** Bun's runtime plugins, as far as this file uses them (the platform has no Bun types). */
interface BunPlugins {
  readonly plugin: (plugin: {
    readonly name: string;
    readonly setup: (build: {
      readonly module: (
        specifier: string,
        load: () => {
          readonly exports: typeof shim;
          readonly loader: "object";
        }
      ) => void;
    }) => void;
  }) => void;
}

declare const Bun: BunPlugins;

/** `cloudflare:workers` served from the shim, for every module loaded after. */
const shimWorkers = Effect.sync(() => {
  Bun.plugin({
    name: "cloudflare-workers-shim",
    setup: (build) => {
      build.module("cloudflare:workers", () => ({
        exports: { ...shim },
        loader: "object",
      }));
    },
  });
});

/**
 * A clone of the bare repo at `bare`, its work tree set to `at`, removed
 * when the job ends. The clone shares the repo's objects, so a composed or
 * merged commit is there whatever ref holds it.
 */
const checkoutIn = (bare: string) => (at: CheckAt) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const dir = yield* fs
      .makeTempDirectoryScoped({ prefix: "world-check-" })
      .pipe(Effect.mapError(() => new VerifierBlocked({})));

    const tree = `${dir}/tree`;

    const cloned = yield* git(
      dir,
      "clone",
      "--shared",
      "--no-checkout",
      "--quiet",
      bare,
      tree
    );

    const read =
      cloned.exitCode === 0
        ? yield* git(tree, "read-tree", "--reset", "-u", shaOf(at))
        : cloned;

    return read.exitCode === 0 ? tree : yield* new VerifierBlocked({});
  }).pipe(Effect.provide(NodeServices.layer));

/** The Checker over the world's bare repos: each job's lanes, for real, in a clone of its repo. */
const localChecker = (repos: string): Layer.Layer<CheckRunner> =>
  Layer.succeed(
    CheckRunner,
    CheckRunner.of({
      run: (job) =>
        CheckRunner.use((runner) => runner.run(job)).pipe(
          Effect.provide(
            CheckRunnerLocal.layer({
              checkout: checkoutIn(`${repos}/${job.repo}.git`),
            }).pipe(Layer.provide(NodeServices.layer))
          )
        ),
    })
  );

const decodeSessions = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String))
);

const serve = Effect.gen(function* () {
  yield* shimWorkers;

  const raw = yield* Config.String("WORLD_SESSIONS").pipe(
    Config.withDefault("{}")
  );

  const sessions = yield* decodeSessions(raw).pipe(
    Effect.catch(() =>
      Effect.die("WORLD_SESSIONS is not a JSON object from token to handle")
    )
  );

  const { coreLoopWorld } = yield* Effect.promise(() => import("./world.ts"));
  const world = yield* coreLoopWorld({ checker: localChecker, sessions });

  yield* Console.log(JSON.stringify({ origin: world.origin }));

  const stdio = yield* Stdio.Stdio;

  yield* Stream.runDrain(stdio.stdin);
});

NodeRuntime.runMain(
  serve.pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
