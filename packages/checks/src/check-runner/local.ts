/**
 * `CheckRunner` as real processes on this machine, for the CLI's `check`:
 * each job gets a checkout from the caller (the CLI makes a git worktree), and
 * each lane runs there under `sh -c`, one after another, to its time limit.
 *
 * It reaches nothing a lane would not: no network of its own, no git config
 * from this machine (`GIT_CONFIG_GLOBAL=/dev/null`, as `@repo/testkit/git`
 * runs git), no repo but the checkout (a hook's `GIT_DIR` is unset), and a
 * `HOME` in a temp dir it removes after the job. Placeholders
 * and proxies are the Checker's; here a lane sees the user's own env. A sealed
 * suite runs only in the Checker, so a job with one is `VerifierBlocked`.
 * A count lane (`output: "stdout"`) hands back what it printed, as the
 * Checker's does.
 */
import { VerifierBlocked } from "@repo/protocol/refusal";
import { Duration, Effect, FileSystem, Layer, Option, Stream } from "effect";
import type { Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { CheckRunner, evidenceFrom } from "../check-runner.ts";
import type { CheckAt, CheckLane, LaneOutput } from "../check-runner.ts";
import { classifyRun } from "../classify.ts";
import type { RunExit } from "../classify.ts";

export interface LocalOptions {
  /** Makes the job's tree a directory, removed when the scope closes. */
  readonly checkout: (
    at: CheckAt
  ) => Effect.Effect<string, VerifierBlocked, Scope.Scope>;
}

/** A lane with no time limit of its own gets ten minutes. */
const DEFAULT_TIMEOUT = Duration.minutes(10);

/** After the time limit's SIGTERM, how long a lane has before SIGKILL. */
const FORCE_KILL_AFTER = Duration.seconds(2);

// Fixed identity and dates, English messages, no prompts, no colours, and no
// git config from this machine. A git hook that runs the CLI exports where
// its own repo is and any `git -c` config; those are unset (an `undefined`
// value leaves a variable out), so a lane's git sees only the checkout.
const fixedEnv = {
  CI: "1",
  FORCE_COLOR: "0",
  GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
  GIT_AUTHOR_DATE: "2026-10-06T12:00:00Z",
  GIT_AUTHOR_EMAIL: "answerer@example.com",
  GIT_AUTHOR_NAME: "Answerer",
  GIT_COMMITTER_DATE: "2026-10-06T12:00:00Z",
  GIT_COMMITTER_EMAIL: "answerer@example.com",
  GIT_COMMITTER_NAME: "Answerer",
  GIT_COMMON_DIR: undefined,
  GIT_CONFIG: undefined,
  GIT_CONFIG_COUNT: undefined,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_PARAMETERS: undefined,
  GIT_DIR: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_NAMESPACE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_PREFIX: undefined,
  GIT_TERMINAL_PROMPT: "0",
  GIT_WORK_TREE: undefined,
  LC_ALL: "C",
  NO_COLOR: "1",
};

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

const timedOut: RunExit = { code: -1, stderr: "", stdout: "", timedOut: true };

// A count lane that ran to its end hands back its stdout, which its count is
// read from; any other lane's output goes nowhere.
const printed = (lane: CheckLane, exit: RunExit): readonly LaneOutput[] =>
  lane.output === "stdout" && exit.timedOut !== true
    ? [{ lane: lane.lane, stdout: exit.stdout }]
    : [];

export const CheckRunnerLocal = {
  layer: (
    options: LocalOptions
  ): Layer.Layer<
    CheckRunner,
    never,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
  > =>
    Layer.effect(
      CheckRunner,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const fs = yield* FileSystem.FileSystem;

        // One lane to its end or its time limit. A process a signal ended
        // has no exit code: -1. The scope's close kills its process group.
        const exitOf = (cwd: string, home: string, lane: CheckLane) =>
          Effect.scoped(
            Effect.gen(function* () {
              const child = yield* spawner.spawn(
                ChildProcess.make("sh", ["-c", lane.command], {
                  cwd,
                  env: { ...fixedEnv, HOME: home, TMPDIR: home },
                  extendEnv: true,
                  forceKillAfter: FORCE_KILL_AFTER,
                })
              );

              const [stdout, stderr, code] = yield* Effect.all(
                [
                  text(child.stdout),
                  text(child.stderr),
                  child.exitCode.pipe(
                    Effect.map(Number),
                    Effect.orElseSucceed(() => -1)
                  ),
                ],
                { concurrency: "unbounded" }
              );

              return { code, stderr, stdout } satisfies RunExit;
            })
          ).pipe(
            Effect.timeoutOption(
              lane.timeoutMs === undefined
                ? DEFAULT_TIMEOUT
                : Duration.millis(lane.timeoutMs)
            ),
            Effect.map(Option.getOrElse(() => timedOut)),
            Effect.mapError(() => new VerifierBlocked({}))
          );

        const runLane = (cwd: string, home: string, lane: CheckLane) =>
          Effect.map(
            Effect.timed(exitOf(cwd, home, lane)),
            ([elapsed, exit]) => ({
              exit,
              outputs: printed(lane, exit),
              result: {
                command: lane.command,
                durationMs: Math.round(Duration.toMillis(elapsed)),
                lane: lane.lane,
                result: classifyRun(lane.lane, exit),
              },
            })
          );

        return CheckRunner.of({
          run: (job) =>
            Effect.scoped(
              Effect.gen(function* () {
                if (job.heldBack !== undefined) {
                  return yield* new VerifierBlocked({});
                }

                const cwd = yield* options.checkout(job.at);

                const home = yield* fs
                  .makeTempDirectoryScoped({ prefix: "check-home-" })
                  .pipe(Effect.mapError(() => new VerifierBlocked({})));

                const [elapsed, ran] = yield* Effect.timed(
                  Effect.forEach(job.lanes, (lane) => runLane(cwd, home, lane))
                );

                const outputs = ran.flatMap((each) => each.outputs);

                const done = {
                  durationMs: Math.round(Duration.toMillis(elapsed)),
                  evidence: ran.flatMap(({ exit, result }) =>
                    result.result === "passed"
                      ? []
                      : [evidenceFrom(result.lane, exit)]
                  ),
                  heldBack: [],
                  lanes: ran.map(({ result }) => result),
                };

                return outputs.length === 0 ? done : { ...done, outputs };
              })
            ),
        });
      })
    ),
};
