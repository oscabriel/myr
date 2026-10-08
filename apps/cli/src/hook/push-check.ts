/**
 * The Stop hook's question: does `<cli> check` refuse the work as it stands?
 * Asked through a port, so the hook never imports the check command's
 * modules: the default adapter runs this same CLI as a child process,
 * `check --shape-only --offline --json --base <claim's base>`, and decodes
 * its envelope. Offline, the check cannot read the claim's base itself, and
 * main would be the wrong start for work committed on main.
 */
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

/** The check could not say: it did not start, ran too long, or printed no envelope. */
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
    /**
     * The refusals `<cli> check --shape-only` gives for the repo at `root`,
     * diffed from the claim's `base` as the gateway diffs; none when it passes.
     */
    readonly run: (
      root: string,
      base: string
    ) => Effect.Effect<readonly Refusal[], PushCheckFailed>;
  }
>()("cli/PushCheck") {}

/** The arguments after the CLI's own command. */
const CHECK = ["check", "--shape-only", "--offline", "--json"] as const;

/** The check reads the diff and the config and runs nothing: a minute is plenty. */
const LIMIT = Duration.minutes(1);

const decodeEnvelope = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Envelope(Schema.Unknown))
);

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/**
 * `PushCheck` over a child process: `command` (the CLI, as this process was
 * started) with `check --shape-only --offline --json --base <base>`, in
 * `root`. It exits 1
 * when it refuses, so the exit code says nothing; the envelope says all.
 */
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

/** How this process was started, as the runtime's `process` global reports it. */
const Started = Schema.Struct({
  argv: Schema.Array(Schema.String),
  execPath: Schema.NonEmptyString,
});

/** The global scope, read only for its `process`. */
const GlobalScope = Schema.Struct({ process: Started });

/**
 * The command that runs this CLI again: a compiled binary is its own
 * executable (its entry lives in Bun's embedded `/$bunfs/` or `B:/~BUN/`),
 * otherwise the runtime runs the entry it was started with.
 */
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

/**
 * The default `PushCheck`: this same CLI, run again as a child process.
 * The global scope is decoded at the boundary (the CLI's types name no
 * runtime); a runtime without a `process` (none the CLI ships on) fails
 * every check, which the hook allows.
 */
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
