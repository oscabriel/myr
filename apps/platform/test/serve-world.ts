// Run as a process (`bun apps/platform/test/serve-world.ts`), not imported: apps never
// import apps. Prints `{"origin":"http://127.0.0.1:<port>"}` once it serves, and
// serves until its stdin ends.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import type { RepoHost } from "@repo/artifacts/repo-host";
import { CheckRunner, shaOf } from "@repo/checks/check-runner";
import type { CheckAt } from "@repo/checks/check-runner";
import { CheckRunnerLocal } from "@repo/checks/check-runner/local";
import { Projects } from "@repo/project/projects";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { git } from "@repo/testkit/git";
import { untouchable } from "@repo/testkit/untouchable";
import {
  Console,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Stdio,
  Stream,
} from "effect";

import type * as Cartridges from "../src/cartridges.ts";
import type { Cartridge } from "../src/cartridges.ts";
import type { decodeEnv, PlatformConfig } from "../src/platform.ts";
import type { WorkerPorts } from "../src/ports.ts";
import { fakeEnv, withPrivateNamespace } from "./fake-env.ts";
import { shimWorkers, worldSessions } from "./world-process.ts";
import type { PlugIn } from "./world.ts";

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

// Typed as `ports.ts` types them, so a platform whose `cartridges.ts` names none
// still typechecks here.
const pluggedFor =
  (plugged: typeof Cartridges) =>
  (config: PlatformConfig): Layer.Layer<never, never, WorkerPorts> => {
    const each: readonly Cartridge[] = Object.values(plugged);

    return Layer.mergeAll(
      Layer.empty,
      ...each.map((cartridge) => cartridge(config))
    );
  };

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

const CARRY_EVERY = Duration.millis(250);

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

  const plugged = cartridgesOver(cartridges, decodeEnv);

  const world = yield* coreLoopWorld({
    checker: localChecker,
    plugIn: plugged,
    sessions,
  });

  yield* world.settle().pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("the world's answer runs failed", cause)
    ),
    Effect.andThen(Effect.sleep(CARRY_EVERY)),
    Effect.forever,
    Effect.forkScoped
  );

  yield* Console.log(JSON.stringify({ origin: world.origin }));

  const stdio = yield* Stdio.Stdio;

  yield* Stream.runDrain(stdio.stdin);
});

NodeRuntime.runMain(
  serve.pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
