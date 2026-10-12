// A port, so the hook never imports the check command's modules. Offline, the check cannot read the
// claim's base itself, so it is passed: main would be the wrong start for work committed on main.
import { Envelope } from "@repo/protocol/envelope";
import type { Refusal } from "@repo/protocol/refusal";
import {
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export class PushCheckFailed extends Schema.TaggedError<PushCheckFailed>()(
  "PushCheckFailed",
  { reason: Schema.String }
) {
  override get message() {
    return `the local check gave no answer: ${this.reason}`;
  }
}

export class PushCheck extends Context.Service<
  PushCheck,
  {
    readonly run: (
      root: string,
      base: string
    ) => Effect.Effect<readonly Refusal[], PushCheckFailed>;
  }
>()("cli/PushCheck") {}

const CHECK = ["check", "--shape-only", "--offline", "--json"] as const;

const LIMIT = Duration.minutes(1);

const decodeEnvelope = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/** A refusal ends with the refusal's exit code, but the envelope says all, so only the envelope is read. */
export const pushCheckWith = (
  command: readonly [string, ...string[]]
): Layer.Layer<PushCheck, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    PushCheck,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const [executable, ...leading] = command;

      const run = (root: string, base: string) =>
        Effect.scoped(
          Effect.gen(function* () {
            const child = yield* spawner.spawn(
              ChildProcess.make(
                executable,
                [...leading, ...CHECK, "--base", base],
                {
                  cwd: root,
                  stderr: "ignore",
                  stdin: "ignore",
                }
              )
            );

            const [stdout] = yield* Effect.all(
              [text(child.stdout), child.exitCode],
              { concurrency: "unbounded" }
            );

            return stdout;
          })
        ).pipe(
          Effect.timeoutOrElse({
            duration: LIMIT,
            orElse: () =>
              Effect.fail(
                new PushCheckFailed({
                  reason: `it ran past ${Duration.format(LIMIT)}`,
                })
              ),
          }),
          Effect.catchTag("PlatformError", (failure) =>
            Effect.fail(new PushCheckFailed({ reason: failure.message }))
          ),
          Effect.flatMap((stdout) =>
            decodeEnvelope(stdout.trim()).pipe(
              Effect.mapError(
                () =>
                  new PushCheckFailed({
                    reason: "it printed no envelope on stdout",
                  })
              )
            )
          ),
          Effect.map((envelope): readonly Refusal[] =>
            envelope.ok ? [] : envelope.refusals
          )
        );

      return { run };
    })
  );

const Started = Schema.Struct({
  argv: Schema.Array(Schema.String),
  execPath: Schema.NonEmptyString,
});

const GlobalScope = Schema.Struct({ process: Started });

/** A compiled binary is its own executable: its entry lives in Bun's embedded `/$bunfs/` or `B:/~BUN/`. */
export const selfCommand = (
  started: typeof Started.Type
): readonly [string, ...string[]] => {
  const [, entry] = started.argv;

  return entry === undefined ||
    entry.startsWith("/$bunfs/") ||
    entry.startsWith("B:/~BUN/")
    ? [started.execPath]
    : [started.execPath, entry];
};

export const PushCheckChild: Layer.Layer<
  PushCheck,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Layer.unwrap(
  Effect.sync(() => {
    // Unknown on purpose: the runtime is whatever started this process.
    const scope: unknown = globalThis;

    return Option.match(Schema.decodeUnknownOption(GlobalScope)(scope), {
      onNone: () =>
        Layer.succeed(PushCheck)({
          run: () =>
            Effect.fail(
              new PushCheckFailed({
                reason: "this runtime does not say how the CLI was started",
              })
            ),
        }),
      onSome: ({ process }) => pushCheckWith(selfCommand(process)),
    });
  })
);
