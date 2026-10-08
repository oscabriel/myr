/**
 * The command rows every listing renders from (the platform's skill, the
 * CLI's MCP prompt, the web's `llms.txt`) against the CLI itself: the tree
 * `root` builds, and what each command's `--help` says it takes. A command
 * without a row, a row without a command, or a row naming flags the command
 * doesn't take fails here, before any listing tells an agent so.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { commandDocs, contractCommandDocs } from "@repo/agent-kit/command-doc";
import type { CommandDoc } from "@repo/agent-kit/command-doc";
import { Client, Contracts } from "@repo/protocol/contracts";
import { toJsonSchema } from "@repo/protocol/mcp";
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

const rows: readonly CommandDoc[] = commandDocs(Contracts);

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

/** A payload's JSON Schema, as this test reads it: its fields and the required ones. */
const PayloadFields = Schema.Struct({
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});

const decodePayloadFields = Schema.decodeUnknownSync(PayloadFields);

/** The payload of the contract a contract row projects, as JSON Schema. */
const payloadOf = (row: CommandDoc) => {
  const rpc = Contracts.requests.get(row.contract ?? "");

  return rpc === undefined
    ? {}
    : decodePayloadFields(toJsonSchema(rpc.payloadSchema));
};

const isBoolean = Schema.is(Schema.Struct({ type: Schema.Literal("boolean") }));

/** A boolean field is a switch, which the CLI never requires. */
const isSwitch = (field: Schema.Json | undefined) =>
  field !== undefined && isBoolean(field);

/**
 * The required fields the CLI fills from the repo it stands in, so a person
 * there may leave them out (`fromRepoContext` in `apps/cli/src/surfaces.ts`).
 */
const filledFromRepo = new Set(["project"]);

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

  // A contract's flag is required when its payload field is, unless it is a
  // switch or the CLI fills it from the repo it stands in: `project`, as
  // `filledFromRepo` above says. A field the CLI starts filling, or stops
  // filling, fails here until that list says so too.
  it.effect(
    "require a contract's required fields as flags, all but the --project the repo fills",
    () =>
      Effect.gen(function* () {
        const commands = yield* runnable;

        const differ = contractCommandDocs(Contracts).flatMap((row) => {
          const { properties = {}, required = [] } = payloadOf(row);

          const asked = required.filter(
            (field) =>
              !row.positional.includes(field) &&
              !isSwitch(properties[field]) &&
              !filledFromRepo.has(field)
          );

          const real = (commands.get(words(row))?.takes.flags ?? []).flatMap(
            ({ name, required: needed }) => (needed ? [name] : [])
          );

          return asked.toSorted().join(" ") === real.toSorted().join(" ")
            ? []
            : [{ asked, command: words(row), real }];
        });

        // Known fills, so a CLI that requires `--project` everywhere and a
        // list that fills nothing can't agree.
        expect(
          contractCommandDocs(Contracts).filter((row) =>
            (payloadOf(row).required ?? []).includes("project")
          )
        ).not.toHaveLength(0);
        expect(differ).toStrictEqual([]);
      }),
    30_000
  );
});
