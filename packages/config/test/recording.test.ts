import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  ConfigProvider,
  Console,
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

import { deploy } from "../../../infra/deploy.ts";
import {
  LockFile,
  lockPath,
  recording,
  RecordingInProgress,
  RecordingUsage,
} from "../../../infra/recording.ts";
import { repoRoot } from "./root.ts";

const spawning = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* repoRoot;
  const lines = yield* Ref.make<readonly string[]>([]);

  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      if (!ChildProcess.isStandardCommand(command)) {
        return yield* Effect.die("the deploy pipes no commands");
      }

      const cwd = path.relative(root, command.options.cwd ?? root);

      yield* Ref.update(lines, (all) => [
        ...all,
        `${cwd === "" ? "." : cwd}$ ${[path.basename(command.command), ...command.args].join(" ")}`,
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

const tempLock = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "recording-806-" });

  yield* fs.makeDirectory(path.join(root, "infra"));

  return path.join(root, lockPath);
});

const deployed = (argv: readonly string[], lock: string) =>
  Effect.gen(function* () {
    const fake = yield* spawning;

    const result = yield* deploy(argv).pipe(
      Effect.provide(fake.layer),
      Effect.provideService(LockFile, lock),
      // No STAGE_SECRETS_FILE or PATH from the shell running the tests.
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: {} })
      ),
      Effect.result
    );

    return { result, spawned: yield* fake.spawned };
  });

const printedBy = (argv: readonly string[], lock: string) =>
  Effect.gen(function* () {
    const printed: string[] = [];

    const captured: Console.Console = {
      ...console,
      log: (...args: readonly unknown[]) => {
        printed.push(args.map(String).join(" "));
      },
    };

    yield* recording(argv).pipe(
      Effect.provideService(Console.Console, captured),
      Effect.provideService(LockFile, lock)
    );

    return printed;
  });

describe("a deploy while a take is being recorded", () => {
  it.live.each([
    [["--stage", "dev-oscabriel"]],
    [["--stage", "demo"]],
    [[]],
  ] as const)(
    "is refused with RecordingInProgress for %j, naming the lock, before any step runs",
    ([argv]) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const lock = yield* tempLock;

        yield* fs.writeFileString(lock, "recording since a moment ago\n");

        const { result, spawned } = yield* deployed(argv, lock);

        expect(result).toStrictEqual(
          Result.fail(new RecordingInProgress({ file: lock }))
        );
        expect(spawned).toStrictEqual([]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect("says what to run to lift it", () =>
    Effect.sync(() => {
      expect(new RecordingInProgress({ file: lockPath }).message).toBe(
        "infra/.recording is there: a take is being recorded (H7), so nothing deploys until a person runs bun infra/recording.ts off"
      );
    })
  );
});

describe("a deploy with no take being recorded", () => {
  it.live("runs the same steps as ever when the lock is absent", () =>
    Effect.gen(function* () {
      const { result, spawned } = yield* deployed(
        ["--stage", "dev-oscabriel"],
        yield* tempLock
      );

      expect(Result.isSuccess(result)).toBeTruthy();
      expect(spawned).toStrictEqual([
        ".$ bun run verify",
        "apps/sandbox$ wrangler deploy --env dev-oscabriel",
        "apps/platform$ varlock-wrangler deploy --env dev-oscabriel",
        "apps/web$ bun run build",
        "apps/web$ wrangler deploy --env dev-oscabriel",
        ".$ bun run bootstrap --stage dev-oscabriel --check-triggers",
        ".$ bun scripts/smoke.ts --stage dev-oscabriel",
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

describe("bun infra/recording.ts", () => {
  it.live(
    "on writes the lock and refuses deploys; status says so; off removes it, and deploys run again",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const lock = yield* tempLock;
        const before = yield* printedBy(["status"], lock);
        const on = yield* printedBy(["on"], lock);
        const held = yield* printedBy(["status"], lock);
        const refused = yield* deployed(["--stage", "dev-oscabriel"], lock);
        const off = yield* printedBy(["off"], lock);
        const again = yield* printedBy(["off"], lock);
        const after = yield* deployed(["--stage", "dev-oscabriel"], lock);

        expect({
          after: after.spawned.length,
          again,
          before,
          held: held.map((line) => line.replace(/since \S+;/u, "since <t>;")),
          lockGone: !(yield* fs.exists(lock)),
          off,
          on: on.map((line) => line.replace(/since \S+;/u, "since <t>;")),
          refused: refused.result,
        }).toStrictEqual({
          after: 7,
          again: ["recording: off already; deploys run"],
          before: ["recording: off; deploys run"],
          held: [
            "recording: on (recording since <t>; bun infra/recording.ts off lifts it)",
          ],
          lockGone: true,
          off: ["recording: off; deploys run again"],
          on: [
            "recording: on since <t>; every deploy is refused until bun infra/recording.ts off",
          ],
          refused: Result.fail(new RecordingInProgress({ file: lock })),
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("refuses a command it doesn't know, and changes nothing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const lock = yield* tempLock;

      const failure = yield* Effect.flip(printedBy(["pause"], lock));

      expect({ exists: yield* fs.exists(lock), failure }).toStrictEqual({
        exists: false,
        failure: new RecordingUsage({ given: "pause" }),
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
