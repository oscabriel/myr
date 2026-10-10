/**
 * The CLI's command tree and the program that runs it. `bin.ts` runs
 * `program` with the real services (`CliServices`); tests run it, or `root`,
 * with theirs.
 */
import { Brand } from "@repo/brand";
import { ApprovalNeeded, MissingValue, Reported } from "@repo/protocol/cli";
import { ExitCode } from "@repo/protocol/exit-code";
import { Unauthenticated } from "@repo/protocol/principal";
import { Refusal } from "@repo/protocol/refusal";
import { Console, Effect, Exit, Layer, Option, Runtime, Schema } from "effect";
import { CliConfig, CliError, Command, GlobalFlag } from "effect/cli";

import { credential } from "./credential-helper.ts";
import { CredentialsFile } from "./credentials.ts";
import { hook } from "./hook.ts";
import { refuseStrangeFlags } from "./local/env-set.ts";
import { holdStdout, Output, OutputLive } from "./output.ts";
import { CurrentMode, Policy } from "./policy.ts";
import {
  isTransportFailure,
  noPlatformOf,
  RemoteClient,
  transportMessage,
} from "./remote.ts";
import { commands, mcp, UnknownCommand } from "./surfaces.ts";
import { cliVersion } from "./version.ts";

/**
 * The three commands that start any contribution, first in `--help`, so a
 * person or an agent who knows nothing else knows where to begin.
 */
export const banner = [
  "Start here:",
  `  ${Brand.cli} asks      list the open asks you could take`,
  `  ${Brand.cli} claim     take one; you get a fork to push your answer to`,
  `  ${Brand.cli} check     run the gate's checks locally before you push`,
].join("\n");

/** The commands at the top: the contracts and the hand-written ones, then the servers. */
const tree = [...commands, mcp, hook, credential];

export const root = Command.make(Brand.cli).pipe(
  Command.withDescription(banner),
  Command.withSubcommands(tree)
);

/** The exit code of a usage error, as for a command line effect/cli can't parse. */
const USAGE = ExitCode.usage;

/**
 * The command was misused and said so in one line on stderr: the program
 * exits 2 and prints nothing more.
 */
export class Misused extends Schema.TaggedError<Misused>()("Misused", {}) {
  override readonly [Runtime.errorExitCode] = USAGE;
  override readonly [Runtime.errorReported] = false;
}

const isRefusal = Schema.is(Refusal);

const isReported = Schema.is(Reported);

const isUnauthenticated = Schema.is(Unauthenticated);

/** Usage errors this CLI shares across its commands, beside effect/cli's. */
const isSharedUsage = Schema.is(
  Schema.Union([ApprovalNeeded, MissingValue, UnknownCommand])
);

/** What to run when the platform does not know who is calling. */
const signIn = [
  "Unauthenticated: the platform does not know who you are",
  `  next: ${Brand.cli} login`,
  "  retryable: no",
].join("\n");

/** How running the tree can fail. */
type Failure = Command.Error<typeof root> | CliError.CliError;

/**
 * Whether a failure is a usage error: a shared one, or one a command marks
 * with exit code 2 (`init`'s `InitMisused`).
 */
const isUsage = (failure: Failure) =>
  isSharedUsage(failure) || Runtime.getErrorExitCode(failure) === USAGE;

/** One line for a failure that is a misuse of the command; none otherwise. */
const usageLine = (failure: Failure): Option.Option<string> => {
  if (CliError.isCliError(failure)) {
    return Option.some(
      Schema.is(CliError.ShowHelp)(failure)
        ? failure.errors.map((error) => error.message).join("; ")
        : failure.message
    );
  }

  if (isUsage(failure) || Schema.isSchemaError(failure)) {
    return Option.some(failure.message);
  }

  return isTransportFailure(failure)
    ? Option.map(noPlatformOf(failure), ({ message }) => message)
    : Option.none();
};

/** What to say on stderr about a failure nobody printed yet, and the code the process ends with. */
const noteFor = (failure: Failure) => {
  if (isUnauthenticated(failure)) {
    return { exitCode: ExitCode.noPerm, note: signIn };
  }

  if (isTransportFailure(failure)) {
    return {
      exitCode: ExitCode.unavailable,
      note: `could not reach the platform: ${transportMessage(failure)}`,
    };
  }

  return { exitCode: ExitCode.failed, note: String(failure) };
};

/** How a failure printed already ends: as it said, or with its refusal's code. */
const printed = (failure: Failure): Option.Option<Reported> => {
  if (isReported(failure)) {
    return Option.some(failure);
  }

  return isRefusal(failure)
    ? Option.some(Reported.of([failure]))
    : Option.none();
};

/**
 * Says once what nobody printed yet, and how the process ends: a misuse in
 * one line on stderr (exit 2); not being signed in with what to run next
 * (77), a platform out of reach (69) and anything else (1), on stderr; a
 * refusal, or anything `Reported`, nothing more, with its own code.
 */
const settle = (
  failure: Failure
): Effect.Effect<never, Reported | Misused, Output> =>
  Option.match(usageLine(failure), {
    onNone: () =>
      Option.match(printed(failure), {
        onNone: () => {
          const { exitCode, note } = noteFor(failure);

          return Output.use((output) => output.note(note)).pipe(
            Effect.andThen(Effect.fail(new Reported({ exitCode })))
          );
        },
        onSome: Effect.fail,
      }),
    onSome: (line) =>
      Output.use((output) => output.note(line)).pipe(
        Effect.andThen(Effect.fail(new Misused()))
      ),
  });

/** Whether a run ended in a misuse effect/cli found: a parse error. */
const isMisuse = (failure: Failure) =>
  Schema.is(CliError.ShowHelp)(failure) && failure.errors.length > 0;

/**
 * effect/cli's built-in flags for `mode`: the wizard prompts, so only a
 * person at a terminal gets it.
 */
const builtInsFor = (policy: Option.Option<Policy["Service"]>) =>
  Option.exists(policy, ({ mode }) => mode !== "human")
    ? GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Wizard)
    : GlobalFlag.BuiltIns;

/**
 * Runs the command `argv` names. Help asked for, or shown for a group run
 * without a subcommand, is a success. A misuse (a parse error, a missing
 * value, `--yes` left out, any failure whose `Runtime.errorExitCode` is 2)
 * ends as `Misused` (exit 2) after one line on stderr; every other failure
 * ends as `Reported`, printed once: a refusal by the command, with its
 * exit code (`exitCodeFor`), anything else here (`settle`). A defect (a stub's "not built") is not caught: the
 * runtime prints it, loudly. `env set`'s words are screened before
 * effect/cli parses them, so a value typed where a flag goes is never
 * printed back.
 */
export const program = (argv: readonly string[]) =>
  Effect.gen(function* () {
    yield* refuseStrangeFlags(argv);

    const policy = yield* Effect.serviceOption(Policy);
    const stdout = holdStdout(yield* Console.Console);

    const exit = yield* Effect.exit(
      Command.runWith(root.pipe(Command.provideEffectDiscard(stdout.open)), {
        renderErrors: false,
        version: cliVersion,
      })(argv).pipe(
        Effect.provideService(
          CliConfig.CliConfig,
          CliConfig.make({ builtIns: builtInsFor(policy) })
        ),
        Effect.provideService(Console.Console, stdout.console)
      )
    );

    if (!Option.exists(Exit.findErrorOption(exit), isMisuse)) {
      yield* stdout.release;
    }

    return yield* exit;
  }).pipe(
    Effect.catchTag("ShowHelp", (help) =>
      help.errors.length === 0 ? Effect.void : Effect.fail(help)
    ),
    Effect.matchEffect({
      onFailure: (failure) => settle(failure),
      onSuccess: () => Effect.void,
    })
  );

/**
 * What `program` runs on in a real process, beside the host's own services
 * (`BunServices`): the stored credentials, the invocation policy, output in
 * its form, and the platform over HTTP as the stored profile.
 */
export const CliServices = Layer.mergeAll(OutputLive, RemoteClient).pipe(
  Layer.provideMerge(Layer.mergeAll(CurrentMode, CredentialsFile))
);
