import { Effect, Stream } from "effect";
import type { Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export interface Ran {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

// Fixed identity and dates, English messages, and no config from this machine.
const env = {
  GIT_AUTHOR_DATE: "2026-10-06T12:00:00Z",
  GIT_AUTHOR_EMAIL: "answerer@example.com",
  GIT_AUTHOR_NAME: "Answerer",
  GIT_COMMITTER_DATE: "2026-10-06T12:00:00Z",
  GIT_COMMITTER_EMAIL: "answerer@example.com",
  GIT_COMMITTER_NAME: "Answerer",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/** Spawns a process and hands back its handle, for callers that feed stdin. */
export const spawn = (
  command: string,
  args: readonly string[],
  options: ChildProcess.CommandOptions
): Effect.Effect<
  ChildProcessSpawner.ChildProcessHandle,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
    spawner.spawn(
      ChildProcess.make(command, args, {
        ...options,
        env: { ...env, ...options.env },
        extendEnv: true,
      })
    )
  ).pipe(Effect.orDie);

/** Runs git in `cwd` to the end; a failing git is a result, not an error. */
export const git = (cwd: string, ...args: string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawn("git", args, { cwd });

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [text(child.stdout), text(child.stderr), child.exitCode],
        { concurrency: "unbounded" }
      ).pipe(Effect.orDie);

      return { exitCode, stderr, stdout } satisfies Ran;
    })
  );

/** Runs git and returns its trimmed output; a failing git fails the test. */
export const gitOk = (cwd: string, ...args: string[]) =>
  Effect.flatMap(git(cwd, ...args), (ran) =>
    ran.exitCode === 0
      ? Effect.succeed(ran.stdout.trim())
      : Effect.die(
          `git ${args.join(" ")} exited ${ran.exitCode}: ${ran.stderr}`
        )
  );
