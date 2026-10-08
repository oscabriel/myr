/**
 * The core loop's world (`world.ts`) as a process of its own:
 * `bun apps/platform/test/serve-world.ts` serves the platform's fetch
 * handler on a local port, composed as the Worker composes it, and prints
 * one JSON line, `{"origin":"http://127.0.0.1:<port>"}`, once it serves. It
 * serves until its stdin ends (the process that started it closed it, or
 * died) or it is told to stop.
 *
 * Three things differ from the world a test builds in process:
 *
 * - The Checker runs each lane for real, under `sh -c`, in a clone of the
 *   commit or tree it is given (`CheckRunnerLocal`), so an ask's check is
 *   red first, or not, by what it really does.
 * - Beside dora, alice and bob, the people in `WORLD_SESSIONS` (a JSON
 *   object from token to handle, as `SESSION_TOKENS` is) may call.
 * - Every cartridge the platform plugs in (`cartridges.ts`) is plugged in
 *   here too, as `ports.ts` plugs them into the Worker, for a stage whose
 *   private namespace is the world's second store of bare repos: so a
 *   project that declares a layer gets its repo there, and its maintainers
 *   clone and push it through the gateway (W6 608). The `Answer` Workflow
 *   the cartridge starts an admission on keeps the instance and runs
 *   nothing: the world carries no Workflow.
 *
 * The seed's `--world node` runs it (W5 509, `scripts/lib/seed.ts`) and
 * reaches it over HTTP and git, as it reaches a stage. A process, not an
 * import: apps never import apps, and no file outside the platform imports
 * its test world. The Worker's modules import `cloudflare:workers`, which
 * `world-process.ts` serves from the shim before this file loads them.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import type { RepoHost } from "@repo/artifacts/repo-host";
import { CheckRunner, shaOf } from "@repo/checks/check-runner";
import type { CheckAt } from "@repo/checks/check-runner";
import { CheckRunnerLocal } from "@repo/checks/check-runner/local";
import { Projects } from "@repo/project/projects";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { git } from "@repo/testkit/git";
import { untouchable } from "@repo/testkit/untouchable";
import { Console, Effect, FileSystem, Layer, Stdio, Stream } from "effect";

import type * as Cartridges from "../src/cartridges.ts";
import type { decodeEnv, PlatformConfig } from "../src/platform.ts";
import type { WorkerPorts } from "../src/ports.ts";
import { fakeEnv, withPrivateNamespace } from "./fake-env.ts";
import { shimWorkers, worldSessions } from "./world-process.ts";
import type { PlugIn } from "./world.ts";

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

/**
 * The `Answer` Workflow, as far as an admission's start reaches it: the
 * instance is made, or found, and kept; nothing runs it.
 */
const keptAdmissions = untouchable<Env["ANSWER"]>("ANSWER", {
  create: (options) =>
    Promise.resolve(
      untouchable<WorkflowInstance>("an admission", {
        id: options?.id ?? "admission",
      })
    ),
  get: (id) =>
    Promise.resolve(untouchable<WorkflowInstance>("an admission", { id })),
});

/** Every cartridge in `plugged`, for one stage's config, merged. */
const pluggedFor =
  (plugged: typeof Cartridges) =>
  (config: PlatformConfig): Layer.Layer<never, never, WorkerPorts> =>
    Layer.mergeAll(
      Layer.empty,
      ...Object.values(plugged).map((cartridge) => cartridge(config))
    );

/**
 * Every cartridge in `plugged`, over the world's ports, for a stage whose
 * private namespace is `aside`: over the Worker's ports as they are, and
 * over each Project DO's, which reach no `Projects` (only the gateway's
 * side asks it, and a DO serves no git).
 */
const cartridgesOver =
  (
    plugged: typeof Cartridges,
    decode: typeof decodeEnv
  ): ((aside: RepoHost["Service"]) => PlugIn) =>
  (aside) => {
    const all = Layer.unwrap(
      decode(
        withPrivateNamespace({ ...fakeEnv(), ANSWER: keptAdmissions }, aside)
      ).pipe(Effect.orDie, Effect.map(pluggedFor(plugged)))
    );

    return {
      project: all.pipe(
        Layer.provide(
          Layer.succeed(
            Projects,
            untouchable<Projects["Service"]>("Projects, on a Project DO")
          )
        )
      ),
      worker: all,
    };
  };

const serve = Effect.gen(function* () {
  yield* shimWorkers;

  const sessions = yield* worldSessions;

  const { coreLoopWorld } = yield* Effect.promise(() => import("./world.ts"));

  const cartridges = yield* Effect.promise(
    () => import("../src/cartridges.ts")
  );

  const { decodeEnv } = yield* Effect.promise(
    () => import("../src/platform.ts")
  );

  const world = yield* coreLoopWorld({
    checker: localChecker,
    plugIn: cartridgesOver(cartridges, decodeEnv),
    sessions,
  });

  yield* Console.log(JSON.stringify({ origin: world.origin }));

  const stdio = yield* Stdio.Stdio;

  yield* Stream.runDrain(stdio.stdin);
});

NodeRuntime.runMain(
  serve.pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
