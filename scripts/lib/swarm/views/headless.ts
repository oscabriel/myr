import {
  Data,
  Duration,
  Effect,
  FileSystem,
  Fiber,
  Option,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { drivers, HarnessEvent, sessionDirOf } from "../harnesses/index.ts";
import type { HarnessDriver } from "../harnesses/index.ts";
import type { Contributor } from "../roster.ts";
import { scrubbed, SwarmFailed } from "../workspace.ts";
import type { AgentWorkspace } from "../workspace.ts";

export type Turn = Data.TaggedEnum<{
  Start: { readonly brief: string };
  Resume: { readonly session: string; readonly prompt: string };
}>;

export const Turn = Data.taggedEnum<Turn>();

export interface Heard {
  readonly session: Option.Option<string>;
  readonly settled: boolean;
  readonly stopReason: Option.Option<string>;
  readonly failure: Option.Option<string>;
  readonly input: number;
  readonly output: number;
}

export const nothingHeard: Heard = {
  failure: Option.none(),
  input: 0,
  output: 0,
  session: Option.none(),
  settled: false,
  stopReason: Option.none(),
};

export interface Attempted {
  readonly code: Option.Option<number>;
  readonly heard: Heard;
  readonly stderr: string;
}

export interface ViewAttempt {
  readonly contributor: Contributor;
  readonly workspace: AgentWorkspace;
  readonly env: Readonly<Record<string, string>>;
  readonly file: string;
  readonly turn: Turn;
  readonly onSession: Effect.Effect<void>;
}

export interface SwarmView {
  readonly attempt: (
    input: ViewAttempt
  ) => Effect.Effect<
    Attempted,
    SwarmFailed,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
  >;
}

const hear = (heard: Heard, event: HarnessEvent): Heard =>
  HarnessEvent.$match(event, {
    Failed: ({ reason }) => ({ ...heard, failure: Option.some(reason) }),
    SessionStarted: ({ id }) => ({ ...heard, session: Option.some(id) }),
    Settled: ({ stopReason }) => ({
      ...heard,
      settled: true,
      stopReason: Option.orElse(stopReason, () => heard.stopReason),
    }),
    Usage: ({ input, output, stopReason }) => ({
      ...heard,
      failure: Option.none(),
      input: heard.input + input,
      output: heard.output + output,
      stopReason: Option.orElse(stopReason, () => heard.stopReason),
    }),
  });

const EXIT_GRACE = Duration.seconds(10);

const KILL_GRACE = Duration.seconds(5);

const STDERR_TAIL = 2000;

// A settled harness gets `EXIT_GRACE` to exit; then it is killed with its process group.
const attempt = (input: {
  readonly argv: readonly string[];
  readonly driver: HarnessDriver;
  readonly env: Readonly<Record<string, string>>;
  readonly file: string;
  readonly workspace: AgentWorkspace;
  readonly onSession: Effect.Effect<void>;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const [command = "", ...args] = input.argv;
      const scrub = (text: string) => scrubbed(text, input.workspace);

      yield* fs.writeFileString(input.file, "");

      const child = yield* spawner.spawn(
        ChildProcess.make(command, args, {
          cwd: input.workspace.clone,
          env: { ...input.env },
          extendEnv: false,
          forceKillAfter: KILL_GRACE,
          stdin: "ignore",
        })
      );

      const stderr = yield* child.stderr.pipe(
        Stream.decodeText(),
        Stream.runFold(
          () => "",
          (tail, text) => `${tail}${text}`.slice(-STDERR_TAIL)
        ),
        Effect.forkScoped
      );

      const heard = yield* child.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.tap((line) =>
          fs.writeFileString(input.file, `${scrub(line)}\n`, { flag: "a" })
        ),
        Stream.flatMap((line) => Stream.fromIterable(input.driver.parse(line))),
        Stream.tap((event) =>
          HarnessEvent.$is("SessionStarted")(event)
            ? input.onSession
            : Effect.void
        ),
        Stream.takeUntil(HarnessEvent.$is("Settled")),
        Stream.runFold(() => nothingHeard, hear)
      );

      const code = yield* child.exitCode.pipe(
        Effect.timeoutOption(EXIT_GRACE),
        Effect.map(Option.map(Number))
      );

      // A harness still running after its grace keeps its stderr open:
      // its tail is then not waited for.
      const tail = yield* Fiber.join(stderr).pipe(
        Effect.timeoutOption(Duration.seconds(1)),
        Effect.map(Option.getOrElse(() => ""))
      );

      return { code, heard, stderr: scrub(tail).trim() };
    })
  ).pipe(
    Effect.mapError(
      ({ message }) =>
        new SwarmFailed({
          reason: `${input.argv[0] ?? "the harness"} didn't run: ${message}`,
        })
    )
  );

export const headlessView: SwarmView = {
  attempt: ({ contributor, env, file, onSession, turn, workspace }) => {
    const { adapter, handle, harness, model } = contributor;
    const driver = drivers[harness];

    const argv = Turn.$match(turn, {
      Resume: ({ prompt, session }) =>
        driver.resume({ adapter, model, prompt, session, workspace }),
      Start: ({ brief }) =>
        driver.start({
          adapter,
          brief,
          model,
          sessionDir: sessionDirOf(workspace.dir),
          sessionKey: handle,
          workspace,
        }),
    });

    return attempt({ argv, driver, env, file, onSession, workspace });
  },
};
