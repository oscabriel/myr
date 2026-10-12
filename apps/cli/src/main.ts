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

export const banner = [
  "Start here:",
  `  ${Brand.cli} asks      list the open asks you could take`,
  `  ${Brand.cli} claim     take one; you get a fork to push your answer to`,
  `  ${Brand.cli} check     run the gate's checks locally before you push`,
].join("\n");

const tree = [...commands, mcp, hook, credential];

export const root = Command.make(Brand.cli).pipe(
  Command.withDescription(banner),
  Command.withSubcommands(tree)
);

const USAGE = ExitCode.usage;

export class Misused extends Schema.TaggedError<Misused>()("Misused", {}) {
  override readonly [Runtime.errorExitCode] = USAGE;
  override readonly [Runtime.errorReported] = false;
}

const isRefusal = Schema.is(Refusal);

const isReported = Schema.is(Reported);

const isUnauthenticated = Schema.is(Unauthenticated);

const isSharedUsage = Schema.is(
  Schema.Union([ApprovalNeeded, MissingValue, UnknownCommand])
);

const signIn = [
  "Unauthenticated: the platform does not know who you are",
  `  next: ${Brand.cli} login`,
  "  retryable: no",
].join("\n");

type Failure = Command.Error<typeof root> | CliError.CliError;

const isUsage = (failure: Failure) =>
  isSharedUsage(failure) || Runtime.getErrorExitCode(failure) === USAGE;

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

const printed = (failure: Failure): Option.Option<Reported> => {
  if (isReported(failure)) {
    return Option.some(failure);
  }

  return isRefusal(failure)
    ? Option.some(Reported.of([failure]))
    : Option.none();
};

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

const isMisuse = (failure: Failure) =>
  Schema.is(CliError.ShowHelp)(failure) && failure.errors.length > 0;

/** The wizard prompts, so only a person at a terminal gets it. */
const builtInsFor = (policy: Option.Option<Policy["Service"]>) =>
  Option.exists(policy, ({ mode }) => mode !== "human")
    ? GlobalFlag.BuiltIns.filter((flag) => flag !== GlobalFlag.Wizard)
    : GlobalFlag.BuiltIns;

/**
 * A defect is not caught: the runtime prints it. `env set`'s words are screened
 * before effect/cli parses them, so a value typed where a flag goes is never printed back.
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

export const CliServices = Layer.mergeAll(OutputLive, RemoteClient).pipe(
  Layer.provideMerge(Layer.mergeAll(CurrentMode, CredentialsFile))
);
