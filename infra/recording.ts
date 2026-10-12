// Usage: bun infra/recording.ts on | off | status
// The deploy lock: while `infra/.recording` exists, `infra/deploy.ts` refuses
// every deploy, since a deploy restarts the platform's Durable Objects.
// Only `off` lifts it: no flag or environment variable does.
import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
  Console,
  Context,
  DateTime,
  Effect,
  FileSystem,
  Schema,
  Stdio,
} from "effect";

export const lockPath = "infra/.recording";

export const LockFile = Context.Reference<string>("infra/RecordingLockFile", {
  defaultValue: () =>
    decodeURIComponent(new URL(".recording", import.meta.url).pathname),
});

export class RecordingInProgress extends Schema.TaggedError<RecordingInProgress>()(
  "RecordingInProgress",
  { file: Schema.String }
) {
  override get message() {
    return `${this.file} is there: a take is being recorded (H7), so nothing deploys until a person runs bun infra/recording.ts off`;
  }
}

export class RecordingUsage extends Schema.TaggedError<RecordingUsage>()(
  "RecordingUsage",
  { given: Schema.String }
) {
  override get message() {
    return `${this.given === "" ? "no command" : `${this.given} is no command`}: bun infra/recording.ts on | off | status`;
  }
}

const isOn = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  // A lock whose presence can't be read is no reason to deploy blind.
  return yield* fs.exists(yield* LockFile).pipe(Effect.orDie);
});

export const notRecording: Effect.Effect<
  void,
  RecordingInProgress,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const file = yield* LockFile;

  return yield* (yield* isOn)
    ? Effect.fail(new RecordingInProgress({ file }))
    : Effect.void;
});

export const recording = (
  argv: readonly string[]
): Effect.Effect<void, RecordingUsage, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* LockFile;
    const [command = ""] = argv;

    if (command === "on") {
      const since = DateTime.formatIso(yield* DateTime.now);

      yield* fs
        .writeFileString(
          file,
          `recording since ${since}; bun infra/recording.ts off lifts it\n`
        )
        .pipe(Effect.orDie);

      return yield* Console.log(
        `recording: on since ${since}; every deploy is refused until bun infra/recording.ts off`
      );
    }

    if (command === "off") {
      const was = yield* isOn;

      yield* fs.remove(file, { force: true }).pipe(Effect.orDie);

      return yield* Console.log(
        was
          ? "recording: off; deploys run again"
          : "recording: off already; deploys run"
      );
    }

    if (command === "status") {
      return yield* Console.log(
        (yield* isOn)
          ? `recording: on (${(yield* fs.readFileString(file).pipe(Effect.orDie)).trim()})`
          : "recording: off; deploys run"
      );
    }

    return yield* new RecordingUsage({ given: command });
  });

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const args = yield* (yield* Stdio.Stdio).args;

      return yield* recording(args);
    }).pipe(Effect.provide(BunServices.layer))
  );
}
