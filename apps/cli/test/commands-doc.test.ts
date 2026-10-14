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

const Takes = Schema.Struct({
  args: Schema.Array(
    Schema.Struct({ name: Schema.String, required: Schema.Boolean })
  ),
  description: Schema.String,
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

const takesOf = (doc: HelpDoc.HelpDoc) =>
  encodeTakes({
    args: (doc.args ?? []).map(({ name, required }) => ({ name, required })),
    description: doc.description,
    flags: doc.flags.map(({ name, required, type }) => ({
      name,
      required,
      type,
    })),
  });

const plain = CliOutput.defaultFormatter({ colors: false });

const formatter: CliOutput.Formatter = {
  formatCliError: (error) => plain.formatCliError(error),
  formatError: (error) => plain.formatError(error),
  formatErrors: (errors) => plain.formatErrors(errors),
  formatHelpDoc: takesOf,
  formatVersion: (name, version) => plain.formatVersion(name, version),
};

const services = Layer.mergeAll(
  TestConsole.layer,
  CliOutput.layer(formatter),
  Layer.mock(Client)({}),
  SignedOut,
  OutputPlain
).pipe(Layer.provideMerge(NodeServices.layer));

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

// A word that only groups commands (`env`) takes nothing; `ask <ask>` beside `ask open` does.
const isRunnable = ({ command, takes }: Node) =>
  command.subcommands.length === 0 ||
  takes.args.length + takes.flags.length > 0;

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

// `--no-push` names the boolean flag `push`, unless the command has a flag of that very name.
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

const PayloadFields = Schema.Struct({
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});

const decodePayloadFields = Schema.decodeUnknownSync(PayloadFields);

const payloadOf = (row: CommandDoc) => {
  const rpc = Contracts.requests.get(row.contract ?? "");

  return rpc === undefined
    ? {}
    : decodePayloadFields(toJsonSchema(rpc.payloadSchema));
};

const isBoolean = Schema.is(Schema.Struct({ type: Schema.Literal("boolean") }));

const isSwitch = (field: Schema.Json | undefined) =>
  field !== undefined && isBoolean(field);

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
        expect(commands.has("whoami")).toBeTruthy();
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
            takes: { args: [], description: "", flags: [] },
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

  it.effect(
    "say what each command does in the CLI's own words: a local command's exactly, a contract's as its help begins",
    () =>
      Effect.gen(function* () {
        const commands = yield* runnable;

        const differ = rows.flatMap((row) => {
          const said = commands.get(words(row))?.takes.description ?? "";

          const same =
            row.source === "local"
              ? said === row.summary
              : said.startsWith(row.summary);

          return same
            ? []
            : [{ command: words(row), said, summary: row.summary }];
        });

        expect(differ).toStrictEqual([]);
      }),
    30_000
  );

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
