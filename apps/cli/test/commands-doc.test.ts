/**
 * The command rows every reference renders from (`commands.json`, `cli.md`,
 * the platform's skill) against the CLI itself: the tree `root` builds, and
 * what each command's `--help` says it takes. A command without a row, a row
 * without a command, or a row naming flags the command doesn't take fails
 * here, before `bun run gen` writes the docs from the rows.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  contractCommandDocs,
  localCommandDocs,
} from "@repo/agent-kit/command-doc";
import type { CommandDoc } from "@repo/agent-kit/command-doc";
import { Client, Contracts } from "@repo/protocol/contracts";
import { Effect, Layer, Schema } from "effect";
import { CliOutput, Command } from "effect/cli";
import type { HelpDoc } from "effect/cli";
import { TestConsole } from "effect/testing";

import { root } from "../src/main.ts";
import { OutputPlain } from "../src/output.ts";
import { SignedOut } from "./signed-out.ts";

/** What a command's `--help` says it takes, as this test reads it. */
const Takes = Schema.Struct({
  args: Schema.Array(
    Schema.Struct({ name: Schema.String, required: Schema.Boolean })
  ),
  flags: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      required: Schema.Boolean,
      type: Schema.String,
    })
  ),
});

type Takes = typeof Takes.Type;

const encodeTakes = Schema.encodeSync(Schema.fromJsonString(Takes));

const decodeTakes = Schema.decodeSync(Schema.fromJsonString(Takes));

/** The parts of a help page this test compares, as one JSON line. */
const takesOf = (doc: HelpDoc.HelpDoc) =>
  encodeTakes({
    args: (doc.args ?? []).map(({ name, required }) => ({ name, required })),
    flags: doc.flags.map(({ name, required, type }) => ({
      name,
      required,
      type,
    })),
  });

const plain = CliOutput.defaultFormatter({ colors: false });

/** effect/cli's own formatter, but help prints what a command takes as JSON. */
const formatter: CliOutput.Formatter = {
  formatCliError: (error) => plain.formatCliError(error),
  formatError: (error) => plain.formatError(error),
  formatErrors: (errors) => plain.formatErrors(errors),
  formatHelpDoc: takesOf,
  formatVersion: (name, version) => plain.formatVersion(name, version),
};

/**
 * What the CLI runs with here: a test console, that formatter, and a client
 * and credentials `--help` never calls.
 */
const services = Layer.mergeAll(
  TestConsole.layer,
  CliOutput.layer(formatter),
  Layer.mock(Client)({}),
  SignedOut,
  OutputPlain
).pipe(Layer.provideMerge(NodeServices.layer));

/**
 * What the command at `path` takes, from its own `--help`; help that fails
 * to print fails the test.
 */
const helpOf = (path: readonly string[]) =>
  Effect.gen(function* () {
    yield* Command.runWith(root, { version: "0.0.0" })([...path, "--help"]);

    // The console is the test's, so the help just printed is its last line.
    const lines = yield* TestConsole.logLines;

    return decodeTakes(String(lines.at(-1)));
  }).pipe(Effect.provide(services), Effect.orDie);

interface Node {
  readonly path: readonly string[];
  readonly command: Command.Command.Any;
  readonly takes: Takes;
}

/** Every command under `command` in the tree, at any depth, with its help. */
const below = (
  command: Command.Command.Any,
  path: readonly string[]
): Effect.Effect<readonly Node[]> =>
  Effect.forEach(
    command.subcommands.flatMap(({ commands }) => commands),
    (sub) =>
      Effect.gen(function* () {
        const here = [...path, sub.name];
        const node = { command: sub, path: here, takes: yield* helpOf(here) };

        return [node, ...(yield* below(sub, here))];
      })
  ).pipe(Effect.map((nodes) => nodes.flat()));

/**
 * Whether a node is a command a person runs: one with nothing under it, or
 * one that takes arguments or flags of its own (`ask <ask>` beside `ask
 * open`). A word that only groups commands (`env`) takes none.
 */
const isRunnable = ({ command, takes }: Node) =>
  command.subcommands.length === 0 ||
  takes.args.length + takes.flags.length > 0;

/** The CLI's runnable commands, by their words. */
const runnable = below(root, []).pipe(
  Effect.map(
    (nodes) =>
      new Map(
        nodes.filter(isRunnable).map((node) => [node.path.join(" "), node])
      )
  )
);

const rows: readonly CommandDoc[] = [
  ...contractCommandDocs(Contracts),
  ...localCommandDocs,
];

const words = ({ path }: CommandDoc) => path.join(" ");

/**
 * A row's flags as the command declares them: `--no-push` is the negation
 * effect/cli gives the boolean flag `push`, so it names that switch, unless
 * the command has a flag of that very name (`--no-browser`). Only a boolean
 * flag has a negation; any other `--no-…` stays as written.
 */
const declared = (row: CommandDoc, takes: Takes) => {
  const names = new Set(takes.flags.map(({ name }) => name));

  const switches = new Set(
    takes.flags.flatMap(({ name, type }) => (type === "boolean" ? [name] : []))
  );

  return new Set(
    row.flags.map((flag) => {
      const name = flag.replace(/^--/u, "");
      const negated = name.replace(/^no-/u, "");

      return !names.has(name) && switches.has(negated) ? negated : name;
    })
  );
};

describe("the command rows against the CLI", () => {
  it.effect(
    "name exactly the commands the CLI has: none without a row, no row without a command",
    () =>
      Effect.gen(function* () {
        const commands = yield* runnable;

        expect([...commands.keys()].toSorted()).toStrictEqual(
          rows.map(words).toSorted()
        );
        // Known commands, so an empty tree and an empty list can't agree.
        expect(commands.has("asks")).toBeTruthy();
        expect(commands.has("env set")).toBeTruthy();
        expect(commands.has("env")).toBeFalsy();
      }),
    30_000
  );

  it.effect(
    "give each command exactly the flags it takes, and its required arguments in order",
    () =>
      Effect.gen(function* () {
        const commands = yield* runnable;

        const differ = rows.flatMap((row) => {
          const { takes } = commands.get(words(row)) ?? {
            takes: { args: [], flags: [] },
          };

          const flags = [...declared(row, takes)].toSorted();
          const real = takes.flags.map(({ name }) => name).toSorted();

          const positional = takes.args.flatMap(({ name, required }) =>
            required ? [name] : []
          );

          return flags.join(" ") === real.join(" ") &&
            positional.join(" ") === row.positional.join(" ")
            ? []
            : [{ command: words(row), flags, positional, real }];
        });

        expect(differ).toStrictEqual([]);
      }),
    30_000
  );

  // cli.md says a contract's `--project` may be left out inside a project's
  // repo: the CLI fills it from the repo's remote.
  it.effect(
    "leave a contract command's --project optional, for the repo to fill",
    () =>
      Effect.gen(function* () {
        const commands = yield* runnable;

        const required = contractCommandDocs(Contracts).flatMap((row) =>
          (commands.get(words(row))?.takes.flags ?? []).some(
            ({ name, required: needed }) => name === "project" && needed
          )
            ? [words(row)]
            : []
        );

        expect(
          contractCommandDocs(Contracts).filter(({ flags }) =>
            flags.includes("--project")
          )
        ).not.toHaveLength(0);
        expect(required).toStrictEqual([]);
      }),
    30_000
  );
});
