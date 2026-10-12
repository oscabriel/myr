// The value is never an argument, never printed, logged, hashed or measured, and nothing reads it back.
import { Brand } from "@repo/brand";
import { Client, SetEnv } from "@repo/protocol/contracts";
import { EnvKey, ProjectName } from "@repo/protocol/ids";
import {
  DateTime,
  Effect,
  Option,
  Redacted,
  Schema,
  Stdio,
  Stream,
} from "effect";
import { Argument, Command, Flag, Prompt } from "effect/cli";

import { Output } from "../output.ts";
import type { Mode } from "../output.ts";
import { repoContext } from "../repo-context.ts";
import { WorkingDirectory, projectOf, reportRefusals, usage } from "./why.ts";
import type { UsageError } from "./why.ts";

const command = "env set";

const encodeSet = Schema.encodeEffect(SetEnv.successSchema);

const pipeHint = (key: string) =>
  `printf '%s\\n' "$VALUE" | ${Brand.cli} ${command} ${key} --yes`;

/** Shows nothing typed, not even a mask, which would tell its length. An agent or script is never prompted. */
const prompted = (key: EnvKey, mode: Mode) =>
  mode === "human"
    ? Prompt.run(
        Prompt.Hidden({
          message: `Value for ${key} (nothing you type is shown)`,
        })
      )
    : usage(
        `${Brand.cli} never prompts an agent or a script, so pipe the value of ${key} on stdin: ${pipeHint(key)}`
      );

const readValue = (key: EnvKey, mode: Mode) =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;

    const value = (yield* stdio.stdinIsTerminal)
      ? yield* prompted(key, mode)
      : yield* stdio.stdin.pipe(
          Stream.decodeText(),
          Stream.mkString,
          Effect.map((text) => Redacted.make(text.replace(/\r?\n$/u, "")))
        );

    // Whether anything arrived at all; nothing else about it is looked at.
    return Redacted.value(value) === ""
      ? yield* usage(`No value for ${key} arrived: ${pipeHint(key)}`)
      : value;
  });

const projectFor = (named: Option.Option<ProjectName>) =>
  Effect.gen(function* () {
    if (Option.isSome(named)) {
      return named.value;
    }

    const cwd = yield* WorkingDirectory;

    const context = yield* repoContext(cwd).pipe(
      Effect.asSome,
      Effect.catchTag("NotARepo", () => Effect.succeedNone)
    );

    return yield* projectOf(named, context);
  });

/** A test holds this list to the flags `env set --help` names. */
const spellings: ReadonlySet<string> = new Set([
  "--acknowledge-short",
  "--completions",
  "--dry-run",
  "--help",
  "--json",
  "--log-level",
  "--project",
  "--version",
  "--wizard",
  "--yes",
  "-h",
  "-v",
]);

const strangeFlag = (word: string) => {
  const [flag = word] = word.split("=", 1);

  return (
    word.startsWith("-") &&
    word !== "-" &&
    !spellings.has(flag.replace(/^--no-/u, "--"))
  );
};

/** effect/cli would print a stray flag back (or act on a `-h` inside it), so a value typed there must be refused before parsing. */
export const refuseStrangeFlags = (
  argv: readonly string[]
): Effect.Effect<void, UsageError> => {
  const end = argv.indexOf("--");
  const words = end === -1 ? argv : argv.slice(0, end);

  const at = words.findIndex(
    (word, index) => word === "env" && words[index + 1] === "set"
  );

  return at !== -1 && words.slice(at + 2).some(strangeFlag)
    ? usage(
        `${Brand.cli} ${command} was given a flag it does not take, not repeated here in case it holds the value; the value is read from stdin, never from arguments: ${pipeHint("<KEY>")}`
      )
    : Effect.void;
};

export const envSet = Command.make(
  "set",
  {
    acknowledgeShort: Flag.Boolean("acknowledge-short").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Store a value shorter than the item's minimum anyway"
      )
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Print what would be sent, value redacted; send nothing"
      )
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print machine-readable JSON")
    ),
    key: Argument.String("key").pipe(
      Argument.withSchema(EnvKey),
      Argument.withDescription("The @sensitive env item to set")
    ),
    project: Flag.String("project").pipe(
      Flag.withSchema(ProjectName),
      Flag.optional,
      Flag.withDescription(
        "The project; the repo's platform remote names it by default"
      )
    ),
    // Caught here, so the parser never echoes a value typed as an argument.
    stray: Argument.String("not-the-value").pipe(
      Argument.variadic(),
      Argument.withDescription(
        "Refused: the value is read from stdin, never from arguments"
      )
    ),
    yes: Flag.Boolean("yes").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Store the value (it needs approval)")
    ),
  },
  ({ acknowledgeShort, dryRun, json, key, project, stray, yes }) =>
    Effect.gen(function* () {
      if (stray.length > 0) {
        return yield* usage(
          `${Brand.cli} ${command} takes the value on stdin, never as an argument, so it stays out of shell history and process lists: ${pipeHint(key)}`
        );
      }

      const name = yield* projectFor(project);
      const output = yield* Output;
      const acknowledged = acknowledgeShort ? { acknowledgeShort } : {};

      if (dryRun) {
        return yield* output.plan({
          command,
          json,
          payload: { ...acknowledged, key, project: name, value: "<redacted>" },
        });
      }

      if (!yes) {
        return yield* usage(
          `${command} stores a value for ${key}: add --yes to store it, or --dry-run to see what would be sent.`
        );
      }

      const value = yield* readValue(key, output.mode);
      const client = yield* Client;

      const set = yield* client.setEnv({
        ...acknowledged,
        key,
        project: name,
        value,
      });

      const at = DateTime.formatIso(set.setAt);

      return yield* output.success({
        command,
        data: yield* encodeSet(set).pipe(Effect.orDie),
        json,
        view: {
          markdown: `\`${set.key}\` on ${name} was set by ${set.setBy} at ${at}. Nobody can read it back.`,
          text: `${set.key} on ${name} was set by ${set.setBy} at ${at}. Nobody can read it back.`,
        },
      });
    }).pipe(reportRefusals(command, json))
).pipe(
  Command.withDescription(
    "Set a sensitive env item's value from stdin; nobody can read it back."
  )
);
