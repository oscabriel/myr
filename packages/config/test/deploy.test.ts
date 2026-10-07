import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  ConfigProvider,
  Effect,
  FileSystem,
  Layer,
  Path,
  Ref,
  Result,
  Sink,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  deploy,
  NoStage,
  StepFailed,
  UnknownStage,
} from "../../../infra/deploy.ts";
import { repoRoot } from "./root.ts";

/** One command the deploy spawned, with its folder relative to the repo root. */
interface Spawned {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * A `ChildProcessSpawner` that runs nothing: it records each command and
 * answers with the exit code `exitOf` gives it.
 */
const recording = (exitOf: (spawned: Spawned) => number) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const root = yield* repoRoot;
    const spawned = yield* Ref.make<readonly Spawned[]>([]);

    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        if (!ChildProcess.isStandardCommand(command)) {
          return yield* Effect.die("the deploy pipes no commands");
        }

        const call: Spawned = {
          args: command.args,
          command: path.basename(command.command),
          cwd: path.relative(root, command.options.cwd ?? root),
          env: command.options.env ?? {},
        };

        yield* Ref.update(spawned, (calls) => [...calls, call]);

        return ChildProcessSpawner.makeHandle({
          all: Stream.empty,
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitOf(call))),
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
      spawned: Ref.get(spawned),
    };
  });

/** `deploy(argv)` over a recording spawner: what it spawned, and how it ended. */
const run = (
  argv: readonly string[],
  options: {
    readonly exitOf?: (spawned: Spawned) => number;
    readonly env?: Readonly<Record<string, string>>;
  } = {}
) =>
  Effect.gen(function* () {
    const fake = yield* recording(options.exitOf ?? (() => 0));

    const result = yield* deploy(argv).pipe(
      Effect.provide(fake.layer),
      // Only what the test sets, whatever the shell running the tests has.
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: { ...options.env } })
      ),
      Effect.result
    );

    return { result, spawned: yield* fake.spawned };
  }).pipe(Effect.provide(NodeServices.layer));

/** A spawned command as one line: `apps/sandbox$ wrangler deploy --env x`. */
const line = ({ args, command, cwd }: Spawned) =>
  `${cwd === "" ? "." : cwd}$ ${[command, ...args].join(" ")}`;

describe("a deploy without a known stage", () => {
  it.live(
    "fails with NoStage and spawns nothing when no --stage is given",
    () =>
      Effect.gen(function* () {
        const { result, spawned } = yield* run([]);

        expect(result).toStrictEqual(Result.fail(new NoStage()));
        expect(spawned).toStrictEqual([]);
      })
  );

  it.live("fails with NoStage when --stage has no value", () =>
    Effect.gen(function* () {
      const { result, spawned } = yield* run(["--stage"]);

      expect(result).toStrictEqual(Result.fail(new NoStage()));
      expect(spawned).toStrictEqual([]);
    })
  );

  it.live.each(["prod", "dev-", "dev-Alice", "dev-nobody", "local"])(
    "fails with UnknownStage for --stage %s and spawns nothing",
    (stage) =>
      Effect.gen(function* () {
        const { result, spawned } = yield* run(["--stage", stage]);

        expect(result).toStrictEqual(Result.fail(new UnknownStage({ stage })));
        expect(spawned).toStrictEqual([]);
      })
  );
});

describe("a deploy to dev-oscabriel", () => {
  it.live(
    "verifies, deploys sandbox then platform, checks the trigger, then smoke-tests the stage",
    () =>
      Effect.gen(function* () {
        const { result, spawned } = yield* run(["--stage", "dev-oscabriel"]);

        expect(Result.isSuccess(result)).toBeTruthy();
        // apps/web does not exist yet, so nothing deploys it.
        expect(spawned.map(line)).toStrictEqual([
          ".$ bun run verify",
          "apps/sandbox$ wrangler deploy --env dev-oscabriel",
          "apps/platform$ varlock-wrangler deploy --env dev-oscabriel",
          ".$ bun run bootstrap --stage dev-oscabriel --check-triggers",
          ".$ bun scripts/smoke.ts --stage dev-oscabriel",
        ]);
      })
  );

  it.live("takes --stage=dev-oscabriel as well", () =>
    Effect.gen(function* () {
      const { result, spawned } = yield* run(["--stage=dev-oscabriel"]);

      expect(Result.isSuccess(result)).toBeTruthy();
      expect(spawned).toHaveLength(5);
    })
  );

  it.live("stops after a failing verify, and deploys nothing", () =>
    Effect.gen(function* () {
      const { result, spawned } = yield* run(["--stage", "dev-oscabriel"], {
        exitOf: ({ args }) => (args.includes("verify") ? 1 : 0),
      });

      expect(result).toStrictEqual(
        Result.fail(new StepFailed({ exitCode: 1, step: "verify" }))
      );
      expect(spawned.map(line)).toStrictEqual([".$ bun run verify"]);
    })
  );

  it.live("stops after a failing sandbox deploy, before the platform's", () =>
    Effect.gen(function* () {
      const { result, spawned } = yield* run(["--stage", "dev-oscabriel"], {
        exitOf: ({ cwd }) => (cwd === "apps/sandbox" ? 2 : 0),
      });

      expect(result).toStrictEqual(
        Result.fail(new StepFailed({ exitCode: 2, step: "sandbox" }))
      );
      expect(spawned).toHaveLength(2);
    })
  );

  it.live("fails when smoke fails, after everything else ran", () =>
    Effect.gen(function* () {
      const { result, spawned } = yield* run(["--stage", "dev-oscabriel"], {
        exitOf: ({ args }) => (args.includes("scripts/smoke.ts") ? 1 : 0),
      });

      expect(result).toStrictEqual(
        Result.fail(new StepFailed({ exitCode: 1, step: "smoke" }))
      );
      expect(spawned).toHaveLength(5);
    })
  );

  it.live("turns Wrangler's metrics off in every command it spawns", () =>
    Effect.gen(function* () {
      const { spawned } = yield* run(["--stage", "dev-oscabriel"]);

      // One per step: verify, sandbox, platform, triggers, smoke.
      expect(spawned.map(({ env }) => env.WRANGLER_SEND_METRICS)).toStrictEqual(
        ["false", "false", "false", "false", "false"]
      );
    })
  );

  it.live(
    "hands the platform's deploy the values in STAGE_SECRETS_FILE that its .env.schema names, and no other step any",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped();
        const file = path.join(dir, "dev-oscabriel.secrets");

        yield* fs.writeFileString(
          file,
          [
            "# generated for dev-oscabriel",
            "OPERATOR_TOKEN=operator-token-that-is-long-enough-000",
            'SESSION_TOKENS={"alice-token-that-is-long-enough-0000":"alice"}',
            "NOT_IN_THE_SCHEMA=dropped",
          ].join("\n")
        );

        const { result, spawned } = yield* run(["--stage", "dev-oscabriel"], {
          env: { STAGE_SECRETS_FILE: file },
        });

        expect(Result.isSuccess(result)).toBeTruthy();

        const carried = spawned.map(({ env }) =>
          Object.keys(env)
            .filter((key) => key !== "WRANGLER_SEND_METRICS")
            .toSorted()
        );

        expect(carried).toStrictEqual([
          [],
          [],
          ["OPERATOR_TOKEN", "SESSION_TOKENS"],
          [],
          [],
        ]);
        expect(spawned[2]?.env.SESSION_TOKENS).toBe(
          '{"alice-token-that-is-long-enough-0000":"alice"}'
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
