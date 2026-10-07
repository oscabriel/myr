/**
 * Generation's pure core: every file `bun run gen` writes, computed from the
 * one schema in `packages/protocol`, and how the disk differs from it.
 * `scripts/gen.ts` writes or checks; tests import this directly.
 */
import {
  contractCommandDocs,
  localCommandDocs,
} from "@repo/agent-kit/command-doc";
import type { CommandDoc } from "@repo/agent-kit/command-doc";
import {
  agentPluginsBundle,
  claudePlugin,
  platformSkill,
} from "@repo/agent-kit/platform";
import { Brand } from "@repo/brand";
import {
  Client,
  Contracts,
  Destructive,
  Idempotent,
  partsOf,
  surfaced,
  SurfaceName,
  Surfaces,
} from "@repo/protocol/contracts";
import {
  AskId,
  CommitSha,
  DecisionId,
  EnvKey,
  ProjectName,
  RepoPath,
} from "@repo/protocol/ids";
import { listTools, toJsonSchema, toToolkit } from "@repo/protocol/mcp";
import type { ToolListing } from "@repo/protocol/mcp";
import {
  AskBlocked,
  AskFull,
  AttemptsExhausted,
  CapReached,
  ChecksFailed,
  ClaimLapsed,
  DecisionClosed,
  Denounced,
  DirectPush,
  Flake,
  groups,
  HeldBackFailed,
  ImportFailed,
  IncompleteBrief,
  LayerContentInPublicTree,
  NoAsk,
  NotClaimed,
  NotDecider,
  NotRedFirst,
  NotSensitive,
  NotVouched,
  OutOfScope,
  PostureChange,
  PrivatePathInPublicTree,
  ProjectExists,
  ReachedInternals,
  Refusal,
  RepoBusy,
  SecretInOutput,
  StaleBase,
  StaleLayer,
  TouchedJudge,
  UnknownAsk,
  UnknownCommit,
  UnknownDecision,
  UnknownEnvItem,
  UnknownProject,
  UnstatedRequirement,
  ValueTooShort,
  VerifierBlocked,
  WeakCheck,
  Weakened,
} from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import {
  Array as Arr,
  Context,
  DateTime,
  Effect,
  Exit,
  JsonSchema,
  Order,
  Predicate,
  Schema,
  SchemaAST,
  SchemaRepresentation,
} from "effect";

/**
 * The union and the group the reference is rendered from. Tests in
 * `packages/config` read them here: that package takes no `@repo/*`
 * dependency, since every package dev-depends on it and the edge would be a
 * cycle.
 */
export { Refusal } from "@repo/protocol/refusal";

export { Contracts, partsOf } from "@repo/protocol/contracts";

export { Brand } from "@repo/brand";

/**
 * `docs/reference/commands.json`: every command the CLI has, one row per
 * `CommandDoc` (`@repo/agent-kit`), sorted by its words. A `contract` row is
 * a contract projected onto the CLI and carries that contract's hints and
 * payload; a `local` row is written by hand in the CLI, and may name the
 * contract it calls (`init` calls `initProject`). `cli.md`, the platform's
 * skill and `llms.txt` render from the same rows.
 */
export const CommandCatalog = Schema.Struct({
  commands: Schema.Array(
    Schema.Struct({
      contract: Schema.optionalKey(Schema.NonEmptyString),
      description: Schema.String,
      /** A contract row's; a hand-written command has no annotation to give it. */
      destructive: Schema.optionalKey(Schema.Boolean),
      /** Every flag it takes, as typed: `--project`, `--json`. */
      flags: Schema.Array(Schema.NonEmptyString),
      /** A contract row's; a hand-written command has no annotation to give it. */
      idempotent: Schema.optionalKey(Schema.Boolean),
      name: Schema.NonEmptyString,
      needsApproval: Schema.Boolean,
      path: Schema.Array(Schema.NonEmptyString),
      // A contract row's payload as JSON Schema: the same schema MCP lists
      // as the input.
      payloadSchema: Schema.optionalKey(Schema.Json),
      positional: Schema.Array(Schema.String),
      readOnly: Schema.Boolean,
      source: Schema.Literals(["contract", "local"]),
      surfaces: Schema.Array(SurfaceName),
    })
  ),
  version: Schema.Literal(1),
});

export type CommandCatalog = typeof CommandCatalog.Type;

type Command = CommandCatalog["commands"][number];

export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}

export interface Drift {
  readonly stale: readonly string[];
  readonly missing: readonly string[];
  readonly extra: readonly string[];
}

/**
 * The folders gen owns whole: every file in them is generated, so a file gen
 * would not write is a stray.
 */
export const ownedRoots: readonly string[] = [
  "docs/reference",
  "skills",
  "plugins",
];

const contracts = [...Contracts.requests.values()];

const byPath = Order.mapInput(Order.String, (file: GeneratedFile) => file.path);

const byKey = Order.mapInput(
  Order.String,
  ([key]: readonly [string, Schema.Json]) => key
);

/** Effect's JSON Schema output, checked as JSON where it enters gen. */
const toJson = Schema.decodeUnknownSync(Schema.Json);

const isJsonArray = (value: Schema.Json): value is Schema.JsonArray =>
  Array.isArray(value);

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value);

/** The same JSON with every object's keys sorted, so no byte depends on insertion order. */
const sortKeys = (value: Schema.Json): Schema.Json => {
  if (isJsonArray(value)) {
    return value.map(sortKeys);
  }

  if (isJsonObject(value)) {
    return Object.fromEntries(
      Arr.sort(Object.entries(value), byKey).map(([key, item]) => [
        key,
        sortKeys(item),
      ])
    );
  }

  return value;
};

/** JSON as gen writes it: sorted keys and two-space indents. */
const printJson = (value: Schema.Json) =>
  JSON.stringify(sortKeys(value), null, 2);

/** A Markdown page: its lines joined, ending in exactly one newline. */
const page = (lines: readonly string[]) =>
  `${lines.join("\n").replace(/\n+$/u, "")}\n`;

const yesNo = (value: boolean) => (value ? "yes" : "no");

const generatedBy = (source: string, edit: string) =>
  `<!-- Generated by \`bun run gen\` from ${source}. Edit ${edit}, not this file: \`bun run gen:check\` fails when they differ. -->`;

// --- refusals.md ------------------------------------------------------------

type Member = (typeof groups)[number]["members"][number];

const ask = AskId.make("fix-parser");

const base = CommitSha.make("1111111111111111111111111111111111111111");

const main = CommitSha.make("2222222222222222222222222222222222222222");

const path = RepoPath.make("src/a.ts");

const project = ProjectName.make("datekit");

const decision = DecisionId.make("dec-000001");

const key = EnvKey.make("PAYMENTS_KEY");

/**
 * One example of every refusal, for the reason each section quotes. Keyed by
 * tag, so a refusal added to the union fails the typecheck until it has one.
 */
const examples = {
  AskBlocked: AskBlocked.of(ask, [AskId.make("drop-moment")]),
  AskFull: new AskFull({ ask }),
  AttemptsExhausted: new AttemptsExhausted({
    area: "parser",
    resetsAt: DateTime.makeUnsafe("2026-10-07T00:00:00Z"),
  }),
  CapReached: new CapReached({ cap: 3 }),
  ChecksFailed: new ChecksFailed({
    lane: "test",
    logRef: "logs/7",
    next: "bun test src/a.test.ts",
  }),
  ClaimLapsed: ClaimLapsed.of(ask),
  DecisionClosed: new DecisionClosed({ decision }),
  Denounced: new Denounced({}),
  DirectPush: new DirectPush({ ref: "refs/heads/main" }),
  Flake: new Flake({ lane: "test" }),
  HeldBackFailed: new HeldBackFailed({ area: "parser", suite: "edge-cases" }),
  ImportFailed: new ImportFailed({
    reason: "the repo needs a sign-in to read",
  }),
  IncompleteBrief: new IncompleteBrief({ missing: ["territory"] }),
  LayerContentInPublicTree: new LayerContentInPublicTree({ paths: [path] }),
  NoAsk: new NoAsk({}),
  NotClaimed: NotClaimed.of(ask),
  NotDecider: new NotDecider({}),
  NotRedFirst: new NotRedFirst({}),
  NotSensitive: new NotSensitive({ key }),
  NotVouched: new NotVouched({}),
  OutOfScope: new OutOfScope({ paths: [path] }),
  PostureChange: new PostureChange({ from: "open", to: "openCore" }),
  PrivatePathInPublicTree: new PrivatePathInPublicTree({ paths: [path] }),
  ProjectExists: new ProjectExists({ project }),
  ReachedInternals: new ReachedInternals({
    from: path,
    to: "@datekit/format/src/internal.ts",
  }),
  RepoBusy: new RepoBusy({}),
  SecretInOutput: new SecretInOutput({ item: "PAYMENTS_KEY", where: "output" }),
  StaleBase: new StaleBase({ base, conflicts: [path], main }),
  StaleLayer: new StaleLayer({ layer: "maintainers" }),
  TouchedJudge: new TouchedJudge({ paths: [path] }),
  UnknownAsk: new UnknownAsk({ ask }),
  UnknownCommit: new UnknownCommit({ sha: main }),
  UnknownDecision: new UnknownDecision({ decision }),
  UnknownEnvItem: new UnknownEnvItem({ key }),
  UnknownProject: new UnknownProject({ project }),
  UnstatedRequirement: new UnstatedRequirement({ area: "parser" }),
  ValueTooShort: ValueTooShort.of(key, 32),
  VerifierBlocked: new VerifierBlocked({}),
  WeakCheck: new WeakCheck({ weakness: "no assertion" }),
  Weakened: new Weakened({
    weakening: { marker: "it.skip", reason: "flaky on CI" },
  }),
} satisfies {
  readonly [Tag in Refusal["_tag"]]: Extract<Refusal, { readonly _tag: Tag }>;
};

/** Each example's reason, in the renderer's words, by tag. */
const reasons = new Map<string, string>(
  Object.values(examples).map((refusal) => [
    refusal._tag,
    (explain([refusal])[0] ?? "").slice(`${refusal._tag}: `.length),
  ])
);

// Every refusal carries these; the page explains them once, at the top.
const envelope = new Set(["_tag", "at", "next", "retryable"]);

/** A schema's type as it travels on the wire, in TypeScript's notation. */
const wireType = (ast: SchemaAST.AST) =>
  SchemaRepresentation.toCodeDocument(
    SchemaRepresentation.toMultiDocument(
      SchemaRepresentation.toRepresentation(SchemaAST.toEncoded(ast))
    )
  ).codes[0]?.Type ?? "unknown";

/** A field's value when the constructor fills it in, as it does a fixed `next`. */
const constructorDefault = (ast: SchemaAST.AST) => {
  const fill = ast.context?.constructorDefault;

  return fill !== undefined && Exit.isExit(fill) && Exit.isSuccess(fill)
    ? fill.value
    : undefined;
};

const section = (member: Member) => {
  const fields = Object.entries<Schema.Top>(member.fields);
  const { ast: retryable } = member.fields.retryable;
  const next = constructorDefault(member.fields.next.ast);
  const reason = reasons.get(member.identifier);

  const own = fields.flatMap(([name, field]) =>
    envelope.has(name)
      ? []
      : [
          `  - \`${name}\`${SchemaAST.isOptional(field.ast) ? " (optional)" : ""}: \`${wireType(field.ast)}\``,
        ]
  );

  return [
    `### ${member.identifier}`,
    "",
    `- Retryable: ${SchemaAST.isLiteral(retryable) && retryable.literal === true ? "yes" : "no"}`,
    `- Next: ${Predicate.isString(next) ? `\`${next}\`` : "set when it is raised"}`,
    ...(own.length === 0 ? ["- Fields: none"] : ["- Fields:", ...own]),
    ...(reason === undefined ? [] : [`- Reason, for example: ${reason}`]),
    "",
  ];
};

const refusalsDoc = (): GeneratedFile => ({
  content: page([
    generatedBy("packages/protocol/src/refusal.ts", "the union"),
    "",
    "# Refusals",
    "",
    `Every way the platform says no is one refusal from one closed union. The same refusal reaches git's \`remote:\` lines, the \`${Brand.cli}\` CLI and MCP. Every refusal carries:`,
    "",
    "- `_tag`: its name. Tags are public: one is renamed only with an alias.",
    "- `retryable`: whether trying again can help, fixed for each refusal.",
    "- `next`: the command to run next.",
    "- `at` (optional): the `path` and `line` it points at.",
    "",
    "No refusal has a message. Shape refusals accumulate, so one push hears about every one at once. Field types are given as they travel on the wire. Each reason is what the renderer says for one example of that refusal.",
    "",
    ...groups.flatMap((group) => [
      `## ${group.name}`,
      "",
      ...group.members.flatMap(section),
    ]),
  ]),
  path: "docs/reference/refusals.md",
});

// --- mcp-tools.md -------------------------------------------------------------

/** The tools MCP serves, read from the same projection the servers use. */
const tools = (): readonly ToolListing[] =>
  listTools(toToolkit(surfaced("mcp"), Effect.service(Client)).toolkit);

const jsonBlock = (schema: JsonSchema.JsonSchema) => [
  "```json",
  printJson(toJson(schema)),
  "```",
];

const toolSection = (tool: ToolListing) => [
  `## ${tool.name}`,
  "",
  tool.description,
  "",
  "| Hint | Value |",
  "| --- | --- |",
  ...Arr.sort(Object.entries(tool.annotations), byKey).map(
    ([hint, value]) => `| \`${hint}\` | \`${String(value)}\` |`
  ),
  "",
  "### Input",
  "",
  ...jsonBlock(tool.inputSchema),
  "",
  "### Output",
  "",
  ...jsonBlock(tool.outputSchema),
  "",
];

const mcpToolsDoc = (): GeneratedFile => ({
  content: page([
    generatedBy(
      "packages/protocol/src/contracts.ts through `toToolkit` in packages/protocol/src/mcp.ts",
      "the contracts"
    ),
    "",
    "# MCP tools",
    "",
    `Each contract served on MCP is one tool, named by its tag, as \`tools/list\` shows it over \`/mcp\` and over stdio from \`${Brand.cli} mcp\`. A stream has no tool, and no tool takes a write-only value, which must never pass through an agent's transcript. A tool's input is the contract's payload and its output is the contract's success. A refusal comes back as the tool's error result: the refusal as JSON, \`_tag\` and all (see [refusals.md](refusals.md)).`,
    "",
    "The hints come from each contract's own annotations. No tool reaches anything outside the platform, so `openWorldHint` is always false.",
    "",
    ...tools().flatMap(toolSection),
  ]),
  path: "docs/reference/mcp-tools.md",
});

// --- commands.json and cli.md -------------------------------------------------

const byWords = Order.mapInput(Order.String, (doc: CommandDoc) =>
  doc.path.join(" ")
);

/**
 * Every command the CLI has, one row each, sorted by its words: the
 * contracts it projects, and the commands written by hand in it.
 * `apps/cli/test/commands-doc.test.ts` holds this list to the CLI's tree.
 */
const commandDocs = (): readonly CommandDoc[] =>
  Arr.sort([...contractCommandDocs(Contracts), ...localCommandDocs], byWords);

/** The contract a contract row projects; a row naming none is a defect. */
const contractOf = (doc: CommandDoc) => {
  const rpc =
    doc.contract === undefined
      ? undefined
      : Contracts.requests.get(doc.contract);

  if (rpc === undefined) {
    throw new Error(
      `commands.json: ${doc.path.join(" ")} names no contract the group has`
    );
  }

  return rpc;
};

/** A row as commands.json holds it. */
const rowOf = (doc: CommandDoc): Command => {
  // The doc's own keys: `contract` only where the doc names one.
  const { source: _source, summary, ...shared } = doc;
  const common = { ...shared, description: summary, name: doc.path.join(" ") };

  if (doc.source === "local") {
    return { ...common, source: "local", surfaces: ["cli"] };
  }

  const rpc = contractOf(doc);

  return {
    ...common,
    destructive: Context.get(rpc.annotations, Destructive),
    idempotent: Context.get(rpc.annotations, Idempotent),
    payloadSchema: toJson(toJsonSchema(rpc.payloadSchema)),
    source: "contract",
    surfaces: Context.get(rpc.annotations, Surfaces),
  };
};

const catalogOf = (docs: readonly CommandDoc[]): CommandCatalog => ({
  commands: docs.map(rowOf),
  version: 1,
});

/** What cli.md reads from a payload's JSON Schema: its fields, and which are required. */
const PayloadFields = Schema.Struct({
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});

const FieldSchema = Schema.Struct({
  enum: Schema.optionalKey(Schema.Array(Schema.Json)),
  type: Schema.optionalKey(Schema.String),
});

const decodePayloadFields = Schema.decodeUnknownSync(PayloadFields);

const isFieldSchema = Schema.is(FieldSchema);

/** What a field of each JSON type takes on the command line. */
const kinds = new Map([
  ["boolean", "nothing (a switch)"],
  ["integer", "a number"],
  ["number", "a number"],
  ["string", "text"],
]);

const SWITCH = "nothing (a switch)";

/**
 * The required payload fields the CLI fills, when they are left out, from
 * the repo it stands in, with where the value comes from: `fromRepoContext`
 * in `apps/cli/src/surfaces.ts`. Its test (`commands-doc.test.ts`) holds
 * every contract command's `--project` optional.
 */
const filledFromRepo = new Map([
  ["project", "the project of the repo you stand in"],
]);

/**
 * A boolean field is a switch: the CLI turns it on by naming it, and it is
 * off by default, so it is never required.
 */
const isSwitch = (field: Schema.Json) =>
  isFieldSchema(field) && field.type === "boolean";

/**
 * What a field takes on the command line, in the words `--help` uses, as a
 * table cell: a choice's values are split by an escaped pipe, which Markdown
 * shows as a pipe and doesn't read as the cell's end.
 */
const takes = (field: Schema.Json) => {
  if (!isFieldSchema(field)) {
    return "JSON";
  }

  if (field.enum !== undefined) {
    return field.enum.map((value) => JSON.stringify(value)).join(" \\| ");
  }

  return (
    (field.type === undefined ? undefined : kinds.get(field.type)) ?? "JSON"
  );
};

/** The words a section is headed by and starts its usage with. */
const commandLine = (command: Command) =>
  [Brand.cli, ...command.path].join(" ");

const heading = (command: Command) => [
  `## \`${commandLine(command)}\``,
  "",
  command.description,
  "",
];

const usageBlock = (usage: readonly string[]) => [
  "```sh",
  usage.join(" "),
  "```",
  "",
];

/**
 * A contract's command: its payload's fields as flags (or positionals), each
 * with what it takes and whether a person must give it, then the switches
 * the CLI adds (`--json`, `--yes`, `--dry-run`).
 */
const contractSection = (command: Command) => {
  const { properties = {}, required = [] } = decodePayloadFields(
    command.payloadSchema ?? {}
  );

  const positional = new Set(command.positional);
  const needed = new Set(required);

  const flags = Arr.sort(Object.entries(properties), byKey).filter(
    ([field]) => !positional.has(field)
  );

  const fromPayload = new Set(flags.map(([field]) => `--${field}`));
  const switches = command.flags.filter((flag) => !fromPayload.has(flag));

  /** Where the CLI takes a required field's value from when it is left out. */
  const filled = (field: string) =>
    needed.has(field) ? filledFromRepo.get(field) : undefined;

  /** Whether a person must give the flag: a switch or a filled field never needs giving. */
  const mustGive = ([field, schema]: readonly [string, Schema.Json]) =>
    needed.has(field) && !isSwitch(schema) && filled(field) === undefined;

  const usageOf = (flag: readonly [string, Schema.Json]) => {
    const [field, schema] = flag;

    if (isSwitch(schema)) {
      return `[--${field}]`;
    }

    return mustGive(flag) ? `--${field} <${field}>` : `[--${field} <${field}>]`;
  };

  const requiredCell = (flag: readonly [string, Schema.Json]) => {
    const from = filled(flag[0]);

    return from === undefined ? yesNo(mustGive(flag)) : `no: ${from}`;
  };

  const rows = [
    ...command.positional.map(
      (field) =>
        `| \`<${field}>\` | ${takes(properties[field] ?? null)} | ${yesNo(needed.has(field))} |`
    ),
    ...flags.map(
      (flag) =>
        `| \`--${flag[0]}\` | ${takes(flag[1])} | ${requiredCell(flag)} |`
    ),
    ...switches.map((flag) => `| \`${flag}\` | ${SWITCH} | no |`),
  ];

  return [
    ...heading(command),
    ...usageBlock([
      commandLine(command),
      ...command.positional.map((field) => `<${field}>`),
      ...flags.map(usageOf),
      ...switches.map((flag) => `[${flag}]`),
    ]),
    ...(command.contract === undefined
      ? []
      : [`- Contract: \`${command.contract}\``]),
    `- Reads only: ${yesNo(command.readOnly)}`,
    `- Idempotent: ${yesNo(command.idempotent ?? false)}`,
    `- Destructive: ${yesNo(command.destructive ?? false)}`,
    `- Needs approval: ${yesNo(command.needsApproval)}`,
    `- Surfaces: ${command.surfaces.join(", ")}`,
    "",
    ...(rows.length === 0
      ? ["It takes no arguments."]
      : ["| Argument | Takes | Required |", "| --- | --- | --- |", ...rows]),
    "",
  ];
};

const named = (names: readonly string[]) =>
  names.length === 0 ? "none" : names.map((name) => `\`${name}\``).join(", ");

/**
 * A command written by hand in the CLI: its arguments and flags by name,
 * and `--help` for what each takes, which only the command itself knows.
 */
const localSection = (command: Command) => [
  ...heading(command),
  ...usageBlock([
    commandLine(command),
    ...command.positional.map((field) => `<${field}>`),
    ...(command.flags.length === 0 ? [] : ["[flags]"]),
  ]),
  command.contract === undefined
    ? "- Written by hand in the CLI"
    : `- Written by hand in the CLI; calls the contract \`${command.contract}\``,
  `- Reads only: ${yesNo(command.readOnly)}`,
  `- Needs approval: ${yesNo(command.needsApproval)}`,
  `- Arguments: ${named(command.positional.map((field) => `<${field}>`))}`,
  `- Flags: ${named(command.flags)}`,
  "",
  `\`${commandLine(command)} --help\` says what each one takes.`,
  "",
];

const commandSection = (command: Command) =>
  command.source === "contract"
    ? contractSection(command)
    : localSection(command);

/** Words joined as a sentence lists them: `a`, `a and b`, `a, b and c`. */
const listed = (items: readonly string[]) =>
  items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;

/** Which commands take `--json`: every one, or every one but those named. */
const withJson = ({ commands }: CommandCatalog) => {
  const without = commands.flatMap((command) =>
    command.flags.includes("--json") ? [] : [`\`${command.name}\``]
  );

  return `Every command${without.length === 0 ? "" : ` but ${listed(without)}`} takes \`--json\`, which prints one versioned JSON envelope instead of Markdown.`;
};

/** cli.md is rendered from the catalog commands.json holds, so the two agree. */
const cliDoc = (commands: CommandCatalog): GeneratedFile => ({
  content: page([
    generatedBy(
      "packages/protocol/src/contracts.ts and the CLI's hand-written commands (packages/agent-kit/src/command-doc.ts) through commands.json",
      "those"
    ),
    "",
    "# CLI",
    "",
    `Every command the \`${Brand.cli}\` CLI has, sorted by its words. Most are contracts projected onto the CLI: the payload's fields become flags, or positional arguments where the contract names them. The rest are written by hand in the CLI, for work done on your machine (\`login\`, \`check\`, \`init\`) or to keep a value out of an argument list (\`env set\`). [commands.json](commands.json) holds the same list as data.`,
    "",
    `${withJson(commands)} A command that needs a person's approval runs only with \`--yes\`, and a contract's command that changes anything takes \`--dry-run\`, which prints what it would send. Inside a project's repo (its own, a claim's fork or a working fork), a contract's command left without the \`--project\` it needs takes the repo's. \`${Brand.cli} schema <command>\` prints the JSON Schema of the payload a command sends.`,
    "",
    ...commands.commands.flatMap(commandSection),
  ]),
  path: "docs/reference/cli.md",
});

const commandsJson = (commands: CommandCatalog): GeneratedFile => ({
  content: `${printJson(commands)}\n`,
  path: "docs/reference/commands.json",
});

// --- skills/ and plugins/ -------------------------------------------------------

/**
 * The repo's own skill and its plugin, from the same command rows. The
 * Claude Code plugin and the Agent Plugins bundle share `plugins/<slug>/`
 * and both carry the platform's skill there, with the same bytes, so it is
 * written once; two different files at one path are a defect.
 */
const agentFiles = (commands: readonly CommandDoc[]) =>
  Effect.all([
    platformSkill({ commands }),
    claudePlugin({ commands }),
    agentPluginsBundle({ commands }),
  ]).pipe(
    Effect.flatMap((all) => {
      const byPathOf = new Map<string, string>();

      for (const file of all.flat()) {
        const seen = byPathOf.get(file.path);

        if (seen !== undefined && seen !== file.content) {
          return Effect.die(
            new Error(`gen: two different files for ${file.path}`)
          );
        }

        byPathOf.set(file.path, file.content);
      }

      return Effect.succeed(
        [...byPathOf].map(([where, content]): GeneratedFile => ({
          content,
          path: where,
        }))
      );
    })
  );

// --- protocol.schema.json -----------------------------------------------------

/**
 * One JSON Schema document for the whole protocol: a definition for each
 * contract's payload, success and error, and for the refusal union, sharing
 * the definitions they name. A stream's success is one of its elements.
 */
const protocolSchema = (): GeneratedFile => {
  const roots: Arr.NonEmptyReadonlyArray<readonly [string, Schema.Top]> = [
    ["Refusal", Refusal],
    ...contracts.flatMap((rpc) => {
      const { error, payload, success } = partsOf(rpc);

      return [
        [`${rpc._tag}.payload`, payload] as const,
        [`${rpc._tag}.success`, success] as const,
        [`${rpc._tag}.error`, error] as const,
      ];
    }),
  ];

  // Each root as JSON encodes it, as `Schema.toJsonSchemaDocument` does.
  const { definitions, schemas } =
    SchemaRepresentation.toJsonSchemaMultiDocument(
      SchemaRepresentation.toRepresentations(
        Arr.map(roots, ([, schema]) => Schema.toCodecJson(schema).ast)
      )
    );

  const clash = roots.find(([name]) => Object.hasOwn(definitions, name));

  if (clash !== undefined) {
    throw new Error(
      `protocol.schema.json: the root ${clash[0]} has the name of a shared definition`
    );
  }

  const document = toJson({
    $comment:
      "Generated by `bun run gen` from packages/protocol. Edit the contracts, not this file.",
    $defs: {
      ...definitions,
      ...Object.fromEntries(
        roots.map(([name], index) => [name, schemas[index] ?? {}])
      ),
    },
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
    title: `The ${Brand.name} protocol`,
  });

  return {
    content: `${printJson(document)}\n`,
    path: "docs/reference/protocol.schema.json",
  };
};

/**
 * Every file gen writes, sorted by path: the reference under
 * `docs/reference/`, the platform's skill under `skills/` and its plugin
 * under `plugins/`. Nothing in them depends on the clock, so running it
 * twice gives the same bytes.
 */
export const generate = (): Effect.Effect<readonly GeneratedFile[]> =>
  Effect.gen(function* () {
    const docs = commandDocs();
    const commands = catalogOf(docs);
    const agents = yield* agentFiles(docs);

    return Arr.sort(
      [
        cliDoc(commands),
        commandsJson(commands),
        mcpToolsDoc(),
        protocolSchema(),
        refusalsDoc(),
        ...agents,
      ],
      byPath
    );
  });

/**
 * How the files on disk under the owned roots differ from what gen would
 * write: changed, not there yet, or not gen's at all.
 */
export const drift = (
  expected: readonly GeneratedFile[],
  onDisk: readonly GeneratedFile[]
): Drift => {
  const disk = new Map(onDisk.map((file) => [file.path, file.content]));
  const wanted = new Set(expected.map((file) => file.path));

  return {
    extra: onDisk
      .flatMap((file) => (wanted.has(file.path) ? [] : [file.path]))
      .toSorted(),
    missing: expected
      .flatMap((file) => (disk.has(file.path) ? [] : [file.path]))
      .toSorted(),
    stale: expected
      .flatMap((file) =>
        disk.has(file.path) && disk.get(file.path) !== file.content
          ? [file.path]
          : []
      )
      .toSorted(),
  };
};
