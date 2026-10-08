import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  Console,
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
  SecretsFileNotForStage,
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
    "verifies, deploys sandbox, platform and web, checks the trigger, then smoke-tests the stage",
    () =>
      Effect.gen(function* () {
        const { result, spawned } = yield* run(["--stage", "dev-oscabriel"]);

        expect(Result.isSuccess(result)).toBeTruthy();
        expect(spawned.map(line)).toStrictEqual([
          ".$ bun run verify",
          "apps/sandbox$ wrangler deploy --env dev-oscabriel",
          "apps/platform$ varlock-wrangler deploy --env dev-oscabriel",
          "apps/web$ bun run build",
          "apps/web$ wrangler deploy --env dev-oscabriel",
          ".$ bun run bootstrap --stage dev-oscabriel --check-triggers",
          ".$ bun scripts/smoke.ts --stage dev-oscabriel",
        ]);
      })
  );

  it.live(
    "ends by printing the redirect URI Google sign-in needs registered (H4)",
    () =>
      Effect.gen(function* () {
        const printed: string[] = [];

        const quiet: Console.Console = {
          ...console,
          log: (...args: readonly unknown[]) => {
            printed.push(args.map(String).join(" "));
          },
        };

        const { result } = yield* run(["--stage", "dev-oscabriel"]).pipe(
          Effect.provideService(Console.Console, quiet)
        );

        expect(Result.isSuccess(result)).toBeTruthy();
        // infra/workers-dev.json records the account's subdomain.
        expect(printed.at(-1)).toBe(
          "deploy dev-oscabriel: to offer Google sign-in, register https://platform-dev-oscabriel.oscargabriel.workers.dev/oauth/google/callback as the Google client's redirect URI (H4)"
        );
      })
  );

  it.live("takes --stage=dev-oscabriel as well", () =>
    Effect.gen(function* () {
      const { result, spawned } = yield* run(["--stage=dev-oscabriel"]);

      expect(Result.isSuccess(result)).toBeTruthy();
      expect(spawned).toHaveLength(7);
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
      expect(spawned).toHaveLength(7);
    })
  );

  it.live("turns Wrangler's metrics off in every command it spawns", () =>
    Effect.gen(function* () {
      const { spawned } = yield* run(["--stage", "dev-oscabriel"]);

      // One per step: verify, sandbox, platform, web build, web, triggers,
      // smoke.
      expect(spawned.map(({ env }) => env.WRANGLER_SEND_METRICS)).toStrictEqual(
        ["false", "false", "false", "false", "false", "false", "false"]
      );
    })
  );

  it.live(
    "builds the web for the stage, as production, before Wrangler deploys that build",
    () =>
      Effect.gen(function* () {
        const { spawned } = yield* run(["--stage", "dev-oscabriel"]);

        const web = spawned.filter(({ cwd }) => cwd === "apps/web");

        // The Vite plugin writes the stage's deploy config at build time, and
        // Wrangler refuses an --env other than the one the build was for. A
        // production build never carries the `development` #backend.
        expect(
          web.map(({ args, env }) => ({
            args,
            stage: env.CLOUDFLARE_ENV,
            vite: env.NODE_ENV,
          }))
        ).toStrictEqual([
          {
            args: ["run", "build"],
            stage: "dev-oscabriel",
            vite: "production",
          },
          {
            args: ["deploy", "--env", "dev-oscabriel"],
            stage: undefined,
            vite: undefined,
          },
        ]);
      })
  );

  it.live(
    "puts each step's own bins first on PATH, so varlock-wrangler starts the platform's pinned wrangler",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const root = yield* repoRoot;

        // `bun run deploy` gives the root's bins, where no wrangler lives.
        const inherited = `${path.join(root, "node_modules/.bin")}:/usr/bin`;

        const { spawned } = yield* run(["--stage", "dev-oscabriel"], {
          env: { PATH: inherited },
        });

        const first = spawned.map(({ cwd, env }) => ({
          cwd,
          first: env.PATH?.split(":")[0],
          rest: env.PATH?.split(":").slice(1).join(":"),
        }));

        expect(first[2]).toStrictEqual({
          cwd: "apps/platform",
          first: path.join(root, "apps/platform/node_modules/.bin"),
          rest: inherited,
        });
        expect(first[1]?.first).toBe(
          path.join(root, "apps/sandbox/node_modules/.bin")
        );
      }).pipe(Effect.provide(NodeServices.layer))
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
            .filter((key) => key !== "PATH" && key !== "WRANGLER_SEND_METRICS")
            .toSorted()
        );

        expect(carried).toStrictEqual([
          [],
          [],
          ["OPERATOR_TOKEN", "SESSION_TOKENS"],
          ["CLOUDFLARE_ENV", "NODE_ENV"],
          [],
          [],
          [],
        ]);
        expect(spawned[2]?.env.SESSION_TOKENS).toBe(
          '{"alice-token-that-is-long-enough-0000":"alice"}'
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

/**
 * The message a failed `deploy(argv)` carries: `runMain` prints a failure as
 * its tag and its message, and nothing else.
 */
const messageOf = (
  argv: readonly string[],
  options: Parameters<typeof run>[1] = {}
) =>
  run(argv, options).pipe(
    Effect.map(({ result }) =>
      Result.isFailure(result) ? result.failure.message : ""
    )
  );

describe("what a failed deploy prints", () => {
  it.live("names the stages it knows when it refuses one", () =>
    Effect.gen(function* () {
      expect(yield* messageOf([])).toBe(
        "no --stage: name one of dev-oscabriel, demo"
      );
      expect(yield* messageOf(["--stage", "prod"])).toBe(
        "--stage prod is not a stage infra/stages.ts declares (dev-oscabriel, demo)"
      );
    })
  );

  it.live("names the step that failed and how", () =>
    Effect.gen(function* () {
      const message = yield* messageOf(["--stage", "dev-oscabriel"], {
        exitOf: ({ cwd }) => (cwd === "apps/platform" ? 3 : 0),
      });

      expect(message).toBe("platform exited 3, so nothing after it ran");
    })
  );

  it.live("says where demo's secrets come from instead", () =>
    Effect.gen(function* () {
      const message = yield* messageOf(["--stage", "demo"], {
        env: { STAGE_SECRETS_FILE: "/nowhere/demo.secrets" },
      });

      expect(message).toBe(
        "STAGE_SECRETS_FILE is for dev stages only: set demo's secrets with varlock (infra/stages.md)"
      );
    })
  );
});

describe("a deploy to demo", () => {
  it.live(
    "refuses STAGE_SECRETS_FILE, whose generated values are the dev stage's alone, before it spawns anything",
    () =>
      Effect.gen(function* () {
        const { result, spawned } = yield* run(["--stage", "demo"], {
          env: { STAGE_SECRETS_FILE: "/nowhere/demo.secrets" },
        });

        expect(result).toStrictEqual(
          Result.fail(new SecretsFileNotForStage({ stage: "demo" }))
        );
        expect(spawned).toStrictEqual([]);
      })
  );
});
