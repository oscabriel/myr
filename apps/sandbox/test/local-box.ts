import { NodeServices } from "@effect/platform-node";
import { Duration, Effect, FileSystem, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { Box, BoxFailed } from "../src/box.ts";
import type { ExecOptions } from "../src/box.ts";

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

const failed =
  (operation: BoxFailed["operation"]) =>
  (cause: { readonly message: string }) =>
    new BoxFailed({ operation, reason: cause.message });

export const LocalBox: Layer.Layer<Box> = Layer.effect(
  Box,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fs = yield* FileSystem.FileSystem;

    const run = (
      [command, ...args]: readonly [string, ...string[]],
      options: ExecOptions
    ) =>
      Effect.scoped(
        Effect.gen(function* () {
          const child = yield* spawner.spawn(
            ChildProcess.make(command, args, {
              cwd: options.cwd,
              env: { ...options.env },
              extendEnv: false,
              forceKillAfter: "1 second",
              stdin: "ignore",
            })
          );

          const [stdout, stderr, exitCode] = yield* Effect.all(
            [text(child.stdout), text(child.stderr), child.exitCode],
            { concurrency: "unbounded" }
          );

          return { exitCode, stderr, stdout };
        })
      ).pipe(Effect.mapError(failed("exec")));

    return Box.of({
      destroy: () => Effect.void,
      exec: (argv, options = {}) =>
        options.timeoutMs === undefined
          ? run(argv, options)
          : Effect.timeoutOrElse(run(argv, options), {
              duration: Duration.millis(options.timeoutMs),
              orElse: () =>
                Effect.fail(
                  new BoxFailed({
                    operation: "exec",
                    reason: `timed out after ${options.timeoutMs} ms`,
                  })
                ),
            }),
      writeFile: (file, bytes) =>
        fs.writeFile(file, bytes).pipe(Effect.mapError(failed("writeFile"))),
    });
  })
).pipe(Layer.provide(NodeServices.layer));
