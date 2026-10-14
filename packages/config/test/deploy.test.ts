import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import {
  Console,
  ConfigProvider,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Result,
  Schema,
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
import { LockFile } from "../../../infra/recording.ts";
import { repoRoot } from "./root.ts";

interface Spawned {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  // When it was spawned, in epoch milliseconds.
  readonly at: number;
}

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
          at: DateTime.toEpochMillis(yield* DateTime.now),
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

const run = (
  argv: readonly string[],
  options: {
    readonly exitOf?: (spawned: Spawned) => number;
    readonly env?: Readonly<Record<string, string>>;
  } = {}
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const fake = yield* recording(options.exitOf ?? (() => 0));

    // A lock nobody wrote, so a local `infra/.recording` never decides these
    // tests; recording.test.ts holds the lock itself.
    const unlocked = path.join(
      yield* fs.makeTempDirectoryScoped({ prefix: "deploy-unlocked-" }),
      ".recording"
    );

    const result = yield* deploy(argv).pipe(
      Effect.provide(fake.layer),
      Effect.provideService(LockFile, unlocked),
      // Only what the test sets, whatever the shell running the tests has.
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: { ...options.env } })
      ),
      Effect.result
    );

    return { result, spawned: yield* fake.spawned };
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

// The instant smoke reads the logs since is the run's own, so a line shows
// where it goes; "hands smoke the instant…" holds its value.
const line = ({ args, command, cwd }: Spawned) =>
  `${cwd === "" ? "." : cwd}$ ${[
    command,
    ...args.map((arg, index) =>
      args[index - 1] === "--since" ? "<since>" : arg
    ),
  ].join(" ")}`;

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

  it.live.each(["staging", "dev-", "dev-Alice", "dev-nobody", "local"])(
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
          ".$ varlock run --path infra/ -- bun scripts/smoke.ts --stage dev-oscabriel --since <since>",
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

  it.live(
    "hands smoke the instant the first upload began, after verify, so an error the replaced version logged during verify never fails it",
    () =>
      Effect.gen(function* () {
        const { result, spawned } = yield* run(["--stage", "dev-oscabriel"]);
        const [verify, sandbox] = spawned;
        const smoke = spawned.at(-1);

        const since = Option.map(
          Schema.decodeUnknownOption(Schema.DateTimeUtcFromString)(
            smoke?.args.at(-1)
          ),
          DateTime.toEpochMillis
        );

        expect(Result.isSuccess(result)).toBeTruthy();
        expect({
          flag: smoke?.args.at(-2),
          since: Option.isSome(since),
          verifiedFirst: Option.exists(
            since,
            (at) => (verify?.at ?? Infinity) <= at
          ),
          withTheUpload: Option.exists(
            since,
            (at) => at <= (sandbox?.at ?? -Infinity)
          ),
        }).toStrictEqual({
          flag: "--since",
          since: true,
          verifiedFirst: true,
          withTheUpload: true,
        });
      })
  );

  it.live("turns Wrangler's metrics off in every command it spawns", () =>
    Effect.gen(function* () {
      const { spawned } = yield* run(["--stage", "dev-oscabriel"]);

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
        "no --stage: name one of dev-oscabriel, prod"
      );
      expect(yield* messageOf(["--stage", "staging"])).toBe(
        "--stage staging is not a stage infra/stages.ts declares (dev-oscabriel, prod)"
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

  it.live("names the secrets file it could not read", () =>
    Effect.gen(function* () {
      const message = yield* messageOf(["--stage", "dev-oscabriel"], {
        env: { STAGE_SECRETS_FILE: "/nowhere/dev-oscabriel.secrets" },
      });

      expect(message).toBe(
        "STAGE_SECRETS_FILE names /nowhere/dev-oscabriel.secrets, which can't be read"
      );
    })
  );
});

describe("a deploy to prod", () => {
  it.live(
    "puts the platform and the web on the brand's own domain, and hands each the other's URL",
    () =>
      Effect.gen(function* () {
        const { result, spawned } = yield* run(["--stage", "prod"]);
        const git = `git.${Brand.domain}`;

        expect(Result.isSuccess(result)).toBeTruthy();
        expect(spawned.map(line)).toStrictEqual([
          ".$ bun run verify",
          "apps/sandbox$ wrangler deploy --env prod",
          `apps/platform$ varlock-wrangler deploy --env prod --domain ${git} --var PUBLIC_WEB_URL:https://${Brand.domain}`,
          "apps/web$ bun run build",
          `apps/web$ wrangler deploy --env prod --domain ${Brand.domain} --domain www.${Brand.domain} --var PUBLIC_PLATFORM_URL:https://${git}`,
          ".$ bun run bootstrap --stage prod --check-triggers",
          ".$ varlock run --path infra/ -- bun scripts/smoke.ts --stage prod --since <since>",
        ]);
      })
  );

  it.live("names the Google redirect URI on the platform's own host", () =>
    Effect.gen(function* () {
      const printed: string[] = [];

      const quiet: Console.Console = {
        ...console,
        log: (...args: readonly unknown[]) => {
          printed.push(args.map(String).join(" "));
        },
      };

      const { result } = yield* run(["--stage", "prod"]).pipe(
        Effect.provideService(Console.Console, quiet)
      );

      expect(Result.isSuccess(result)).toBeTruthy();
      expect(printed.at(-1)).toBe(
        `deploy prod: to offer Google sign-in, register https://git.${Brand.domain}/oauth/google/callback as the Google client's redirect URI (H4)`
      );
    })
  );
});
