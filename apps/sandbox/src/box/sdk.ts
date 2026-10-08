/**
 * `Box` over a Durable Object's own container (`ctx.container`), as the
 * Sandbox SDK 1.0 runs one: the Durable Object starts the container and runs
 * commands through the Container API (`exec`, then `output`); the SDK's
 * `Files` writes files through the `sandbox-shim` every image carries.
 */
import { Files } from "@cloudflare/sandbox";
import { Duration, Effect, Layer } from "effect";

import { Box, BoxFailed } from "../box.ts";
import type { ExecOptions } from "../box.ts";

/**
 * Which image the container runs, whether it may reach the internet, and
 * its instance size (the runtime's default, `lite`, when absent: a
 * Durable Object's container takes its size when it starts, not from
 * `wrangler.jsonc`).
 */
export interface ContainerStart {
  readonly image: string;
  readonly enableInternet: boolean;
  readonly instance?: ContainerStartupOptions["instance"];
}

const text = new TextDecoder();

/** The container, started on first use if it is not running yet. */
const started = (container: Container, start: ContainerStart) =>
  Effect.sync(() => {
    if (!container.running) {
      container.start(
        start.instance === undefined
          ? { enableInternet: start.enableInternet, image: start.image }
          : {
              enableInternet: start.enableInternet,
              image: start.image,
              instance: start.instance,
            }
      );
    }

    return container;
  });

/** The Container API's options for one command; `signal` stops it. */
const execOptions = (options: ExecOptions, signal: AbortSignal) => {
  const exec: ContainerExecOptions = { signal };

  if (options.cwd !== undefined) {
    exec.cwd = options.cwd;
  }

  if (options.env !== undefined) {
    exec.env = { ...options.env };
  }

  return exec;
};

const failed =
  (operation: BoxFailed["operation"]) =>
  (cause: unknown): BoxFailed =>
    new BoxFailed({ operation, reason: String(cause) });

/** One command, run to its end, its output read as text. */
const run = (
  container: Container,
  argv: readonly string[],
  options: ExecOptions
) =>
  Effect.gen(function* () {
    const process = yield* Effect.tryPromise({
      catch: failed("exec"),
      try: (signal) => container.exec([...argv], execOptions(options, signal)),
    });

    // Effect aborts `exec`'s signal only while `exec` itself is pending;
    // once the process runs, an interrupt (a lane's time limit) kills it,
    // or it would run on beside the lanes after it.
    const output = yield* Effect.tryPromise({
      catch: failed("exec"),
      try: () => process.output(),
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          process.kill();
        })
      )
    );

    return {
      exitCode: output.exitCode,
      stderr: text.decode(output.stderr),
      stdout: text.decode(output.stdout),
    };
  });

export const SdkBox = {
  layer: (container: Container, start: ContainerStart): Layer.Layer<Box> =>
    Layer.succeed(
      Box,
      Box.of({
        destroy: () =>
          Effect.ignore(Effect.tryPromise(() => container.destroy())),
        exec: (argv, options = {}) =>
          Effect.flatMap(started(container, start), (running) => {
            const command = run(running, argv, options);

            // Interrupting the command stops it: its signal while it starts,
            // a kill once it runs.
            return options.timeoutMs === undefined
              ? command
              : Effect.timeoutOrElse(command, {
                  duration: Duration.millis(options.timeoutMs),
                  orElse: () =>
                    Effect.fail(
                      new BoxFailed({
                        operation: "exec",
                        reason: `timed out after ${options.timeoutMs} ms`,
                      })
                    ),
                });
          }),
        writeFile: (path, bytes) =>
          Effect.flatMap(started(container, start), (running) =>
            Effect.tryPromise({
              catch: failed("writeFile"),
              try: () => new Files(running).writeFile(path, bytes),
            })
          ),
      })
    ),
};
