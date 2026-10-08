/**
 * Where a contributor's harness runs, and how a prompt reaches it: the
 * swarm's views. A view runs one attempt of a session, its start on the
 * brief or a turn that resumes it, and says what it heard; the verdict loop
 * (`../loop.ts`) decides everything else, from `<cli> status` alone.
 *
 * This file holds the contract every view keeps (`SwarmView`) and the
 * default, headless view: the harness's own process, started with its
 * driver's argv (`../harnesses/`), its stdout read for the session's id,
 * that it settled, and the tokens it used. `herdr.ts` is the other view.
 */
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

/** One attempt of a contributor's session: its start, or a turn that resumes it. */
export type Turn = Data.TaggedEnum<{
  /** The session's first run, on the brief. */
  Start: { readonly brief: string };
  /** The session `session` (what an earlier attempt heard) goes on with `prompt`. */
  Resume: { readonly session: string; readonly prompt: string };
}>;

export const Turn = Data.taggedEnum<Turn>();

/** What one attempt said about its session. */
export interface Heard {
  /** The id a resume names: the harness's session, or the view's own name for it. */
  readonly session: Option.Option<string>;
  readonly settled: boolean;
  readonly stopReason: Option.Option<string>;
  /** Why the run failed on the harness's side, unless a response came after. */
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

/** What one attempt heard, and how it ended. */
export interface Attempted {
  /** The exit code, unless the process was still running when it was let go. */
  readonly code: Option.Option<number>;
  readonly heard: Heard;
  /** The end of what it said on stderr, scrubbed of the token. */
  readonly stderr: string;
}

/** One attempt, as the loop hands it to a view. */
export interface ViewAttempt {
  readonly contributor: Contributor;
  readonly workspace: AgentWorkspace;
  /** The env the harness runs in: the swarm's non-secret names, then the workspace's. */
  readonly env: Readonly<Record<string, string>>;
  /** Where the attempt's output is kept, scrubbed of the token. */
  readonly file: string;
  readonly turn: Turn;
  /** Runs once the attempt has a session: the attempt counts from then. */
  readonly onSession: Effect.Effect<void>;
}

/** Where a contributor's harness runs, and how each prompt reaches it. */
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

/** How long a settled harness gets to exit on its own before it is killed. */
const EXIT_GRACE = Duration.seconds(10);

/** How long a killed harness gets before `SIGKILL`. */
const KILL_GRACE = Duration.seconds(5);

/** The last characters of a harness's stderr kept, to say why it failed. */
const STDERR_TAIL = 2000;

/**
 * One harness process: `argv` in the clone with `env`. Every stdout line
 * goes to `file`, scrubbed of the token, and is read for events until the
 * session settles or the output ends. A settled harness gets `EXIT_GRACE`
 * to exit; then it is killed with its process group.
 */
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

/**
 * The swarm's default view: each attempt is the harness's own process,
 * headless, started (or resumed) with its driver's argv in the clone.
 */
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
