/**
 * The CLI's surfaces: every contract served on the CLI as a command, merged
 * with the hand-written ones by the words that reach them; `schema`, which
 * prints a command's payload as JSON Schema; and `mcp`, the contracts as
 * tools over stdio. The only place the CLI's projections are built.
 */
import { commandDocs } from "@repo/agent-kit/command-doc";
import { platformSkill } from "@repo/agent-kit/platform";
import { Brand } from "@repo/brand";
import { commandName, toCommands } from "@repo/protocol/cli";
import type { CommandRpc, Defaults } from "@repo/protocol/cli";
import {
  Client,
  Contracts,
  surfaced,
  Surfaces,
} from "@repo/protocol/contracts";
import { toToolkit } from "@repo/protocol/mcp";
import {
  briefResources,
  skillIn,
  skillPrompt,
} from "@repo/protocol/mcp-extras";
import type { Skill } from "@repo/protocol/mcp-extras";
import {
  Context,
  Effect,
  JsonSchema,
  Layer,
  Option,
  Predicate,
  Schema,
  SchemaAST,
  SchemaRepresentation,
} from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import { Argument, Command, Flag } from "effect/cli";
import type { ChildProcessSpawner } from "effect/process";

import { local } from "./local/index.ts";
import { Output } from "./output.ts";
import { refusalsIn, views } from "./render.ts";
import { repoContext } from "./repo-context.ts";

/** The folder the CLI stands in: the process's own, unless a test says otherwise. */
export const WorkingDirectory = Context.Reference<string>(
  "cli/WorkingDirectory",
  { defaultValue: () => "." }
);

/**
 * The project a command is about when `--project` is left out: the one the
 * repo the CLI stands in belongs to, by its remote's name (a project's own
 * repo, a claim's fork or a working fork). None outside a platform's repo.
 */
export const fromRepoContext: Defaults<ChildProcessSpawner.ChildProcessSpawner> =
  {
    fields: { project: "the project of the repo you stand in" },
    values: Effect.gen(function* () {
      const here = yield* Effect.option(repoContext(yield* WorkingDirectory));

      return Option.match(
        Option.flatMap(here, ({ repo }) => repo),
        {
          onNone: () => ({}),
          onSome: ({ project }) => ({ project }),
        }
      );
    }),
  };

/** A command, and the words after the CLI's name that reach it. */
export interface CommandEntry {
  readonly path: readonly [string, ...string[]];
  readonly command: Command.Command.Any;
}

/**
 * Contracts that a hand-written command wraps: `init` creates the project
 * after its local work, and `env set` reads the value from stdin so it never
 * passes through an argument list or a transcript.
 */
const wrapped = ["initProject", "setEnv"];

/** Every contract served on the CLI, but those wrapped, as a command. */
const projected = toCommands(Contracts, Effect.service(Client), {
  defaults: fromRepoContext,
  exclude: wrapped,
  output: Effect.service(Output),
  refusalsIn,
  views,
});

/** What a group of commands that is no command itself is for, by its word. */
const groups = new Map([
  ["env", "Read a project's env shape, or set a write-only value."],
]);

/**
 * Entries as a tree: one command per first word, the rest of each path
 * beneath it. A word that is a command and starts longer paths (`ask`, and
 * `ask open`) is a command with subcommands; a word that only starts them
 * (`env`) is a group.
 */
export const merge = (
  all: readonly CommandEntry[]
): readonly Command.Command.Any[] => {
  const words = [...new Set(all.map(({ path: [word] }) => word))];

  return words.map((word) => {
    const here = all.filter(({ path: [first] }) => first === word);
    const own = here.find(({ path }) => path.length === 1)?.command;

    const below = here.flatMap(({ command, path: [, next, ...rest] }) =>
      next === undefined
        ? []
        : [{ command, path: [next, ...rest] } satisfies CommandEntry]
    );

    if (below.length === 0 && own !== undefined) {
      return own;
    }

    const parent =
      own ??
      Command.make(word).pipe(
        Command.withDescription(groups.get(word) ?? `Commands under ${word}.`)
      );

    return Command.withSubcommands(parent, merge(below));
  });
};

/** A command's words, as `schema` and its errors print them. */
const spoken = (words: readonly string[]) => words.join(" ");

/** `schema` was asked for a command that takes no payload, or none at all. */
export class UnknownCommand extends Schema.TaggedError<UnknownCommand>()(
  "UnknownCommand",
  { words: Schema.String }
) {
  override get message() {
    return `${Brand.cli} has no command "${this.words}" that takes a payload; run ${Brand.cli} --help to list them`;
  }
}

/**
 * Every contract served on the CLI, by its command's words, wrapped ones
 * included: `schema env set` describes the payload `env set` sends.
 */
const byWords = new Map(
  [...Contracts.requests.values()].flatMap((rpc) =>
    Context.get(rpc.annotations, Surfaces).includes("cli")
      ? [[commandName(rpc), rpc] as const]
      : []
  )
);

/** Whether a field's value is write-only: a `Redacted` on the decoded side. */
const isWriteOnly = (ast: SchemaAST.AST) =>
  SchemaAST.resolveAt<{ readonly id?: unknown }>("representation")(
    SchemaAST.toType(ast)
  )?.id === "effect/schema/Redacted";

const WRITE_ONLY =
  "Write-only: the platform keeps it and never returns or prints it, and no MCP tool takes it.";

const decodeJson = Schema.decodeUnknownEffect(Schema.Json);

/**
 * A contract's payload as one JSON Schema document (the root as JSON
 * encodes it, as `Schema.toJsonSchemaDocument` does), with every
 * write-only field marked `writeOnly` and described as such.
 */
export const payloadJsonSchema = (rpc: CommandRpc) => {
  const payload = rpc.payloadSchema;

  const { definitions, schemas } =
    SchemaRepresentation.toJsonSchemaMultiDocument(
      SchemaRepresentation.toRepresentations([Schema.toCodecJson(payload).ast])
    );

  const [root] = schemas;

  const writeOnly = SchemaAST.isObjects(payload.ast)
    ? payload.ast.propertySignatures.flatMap(({ name, type }) =>
        Predicate.isString(name) && isWriteOnly(type) ? [name] : []
      )
    : [];

  const properties = Predicate.isObject(root.properties)
    ? Object.fromEntries(
        Object.entries(root.properties).map(([name, field]) => [
          name,
          writeOnly.includes(name) && Predicate.isObject(field)
            ? { ...field, description: WRITE_ONLY, writeOnly: true }
            : field,
        ])
      )
    : undefined;

  const document = Object.fromEntries([
    ["$schema", JsonSchema.META_SCHEMA_URI_DRAFT_2020_12],
    ...Object.entries(root),
    ...(properties === undefined ? [] : [["properties", properties] as const]),
    ...(Object.keys(definitions).length === 0
      ? []
      : [["$defs", definitions] as const]),
  ]);

  return decodeJson(document).pipe(Effect.orDie);
};

/** `schema <command…>`: the payload a command sends, as JSON Schema. */
export const schema = Command.make(
  "schema",
  {
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Print one versioned JSON envelope on stdout, and nothing else there"
      )
    ),
    words: Argument.String("command").pipe(
      Argument.variadic({ min: 1 }),
      Argument.withDescription("The command's words: claim, ask open, env set")
    ),
  },
  ({ json, words }) =>
    Effect.gen(function* () {
      const rpc = byWords.get(spoken(words));

      if (rpc === undefined) {
        return yield* new UnknownCommand({ words: spoken(words) });
      }

      const document = yield* payloadJsonSchema(rpc);
      const text = JSON.stringify(document, null, 2);
      const output = yield* Output;

      return yield* output.success({
        command: "schema",
        data: document,
        json,
        view: { markdown: text },
      });
    })
).pipe(
  Command.withDescription(
    "Print the JSON Schema of the payload a command sends."
  )
);

/** Every command the CLI has, projected or hand-written, by its path. */
export const entries: readonly CommandEntry[] = [
  ...projected,
  ...local,
  { command: schema, path: ["schema"] },
];

/** Any command in the tree: what it may fail with, and what it needs. */
type Every =
  | (typeof projected)[number]["command"]
  | (typeof local)[number]["command"]
  | typeof schema;

/**
 * A command at the top of the tree. Merging erases each command's own type,
 * so the tree states what all of them together may fail with and need.
 */
export type TreeCommand = Command.Command<
  string,
  never,
  unknown,
  Command.Error<Every>,
  Command.Services<Every>
>;

/** The CLI's commands at the top, merged by path. */
export const commands: readonly TreeCommand[] = merge(entries);

const projection = toToolkit(surfaced("mcp"), Effect.service(Client));

/**
 * The platform's skill, made from agent-kit's command list, the one the
 * platform's prompt and the web's `llms.txt` read, so they say the same.
 */
const skill = skillIn(platformSkill({ commands: commandDocs(Contracts) }));

/**
 * The MCP-surfaced contracts as tools over stdio, beside each ask's brief
 * and the projects as resources and `made` as the prompt `contribute`, in
 * every protocol a harness may speak: the stateless 2026-07-28 one, and the
 * four session-based ones before it. Calls go through the `Client`.
 */
const server = (made: Skill) =>
  Layer.mergeAll(
    McpServer.toolkit(projection.toolkit).pipe(
      Layer.provideMerge(projection.layer)
    ),
    briefResources,
    skillPrompt(made)
  ).pipe(
    Layer.provide(
      McpServer.layerStdio({
        name: Brand.name,
        protocols: [
          McpProtocol.v2026_07_28,
          McpProtocol.v2025_11_25,
          McpProtocol.v2025_06_18,
          McpProtocol.v2025_03_26,
          McpProtocol.v2024_11_05,
        ],
        version: "0.0.0",
      })
    )
  );

/**
 * `mcp`: serve the contracts to a harness that spawned this process. The
 * skill is made before the server reads stdin: the server starts reading
 * as soon as it is built, so a prompt made while it builds could miss a
 * client's first `prompts/get`.
 */
export const mcp = Command.make("mcp", {}, () =>
  Effect.flatMap(skill, (made) => Layer.launch(server(made)))
).pipe(
  Command.withDescription("Serve the platform's tools over MCP on stdio.")
);
