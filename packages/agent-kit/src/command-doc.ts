import {
  Cli,
  Description,
  NeedsApproval,
  ReadOnly,
  Surfaces,
} from "@repo/protocol/contracts";
import type { Contracts } from "@repo/protocol/contracts";
import { Array as Arr, Context, Order, Schema, SchemaAST } from "effect";

export const CommandDoc = Schema.Struct({
  contract: Schema.optionalKey(Schema.NonEmptyString),
  flags: Schema.Array(Schema.NonEmptyString),
  needsApproval: Schema.Boolean,
  path: Schema.NonEmptyArray(Schema.NonEmptyString),
  positional: Schema.Array(Schema.NonEmptyString),
  readOnly: Schema.Boolean,
  source: Schema.Literals(["contract", "local"]),
  summary: Schema.NonEmptyString,
});

export type CommandDoc = typeof CommandDoc.Type;

export const localCommandDocs: readonly CommandDoc[] = [
  {
    flags: [
      "--url",
      "--profile",
      "--token-stdin",
      "--no-browser",
      "--no-git-config",
      "--json",
    ],
    needsApproval: false,
    path: ["login"],
    positional: [],
    readOnly: false,
    source: "local",
    summary: "Sign in to a platform; git and this CLI then use its token.",
  },
  {
    flags: ["--profile", "--json"],
    needsApproval: false,
    path: ["logout"],
    positional: [],
    readOnly: false,
    source: "local",
    summary: "Forget a platform's stored token.",
  },
  {
    contract: "initProject",
    flags: [
      "--project",
      "--import",
      "--branch",
      "--yes",
      "--dry-run",
      "--push",
      "--no-push",
      "--json",
    ],
    needsApproval: true,
    path: ["init"],
    positional: [],
    readOnly: false,
    source: "local",
    summary:
      "Make this repo, or a public HTTPS repo, a project: find its checks, write its config and push.",
  },
  {
    contract: "openAsk",
    flags: ["--files", "--project", "--yes", "--dry-run", "--json"],
    needsApproval: true,
    path: ["ask", "open"],
    positional: ["ask"],
    readOnly: false,
    source: "local",
    summary:
      "Open an ask by landing its file and its check, read from the config folder's asks/<ask>.ask.ts and the path it names unless --files gives them, once the check fails on main by an assertion, twice in the same way.",
  },
  {
    flags: [
      "--ask",
      "--project",
      "--base",
      "--offline",
      "--shape-only",
      "--lane",
      "--dir",
      "--json",
    ],
    needsApproval: false,
    path: ["check"],
    positional: [],
    readOnly: true,
    source: "local",
    summary: "Run the gate's checks on your answer locally, before you push.",
  },
  {
    contract: "landing",
    flags: ["--project", "--json"],
    needsApproval: false,
    path: ["why"],
    positional: ["location"],
    readOnly: true,
    source: "local",
    summary:
      "Explain a line: the ask, the answer and the people that landed it.",
  },
  {
    contract: "setEnv",
    flags: ["--project", "--acknowledge-short", "--yes", "--dry-run", "--json"],
    needsApproval: true,
    path: ["env", "set"],
    positional: ["key"],
    readOnly: false,
    source: "local",
    summary:
      "Set a sensitive env item's value from stdin; nobody can read it back.",
  },
  {
    flags: ["--json"],
    needsApproval: false,
    path: ["hook"],
    positional: ["event"],
    readOnly: true,
    source: "local",
    summary:
      "Answer a harness hook (session-start, pre-tool-use, stop) with the gate's policy.",
  },
  {
    flags: [],
    needsApproval: false,
    path: ["credential"],
    positional: ["operation"],
    readOnly: false,
    source: "local",
    summary:
      "Be git's credential helper: hand git the stored token for a platform.",
  },
  {
    flags: [],
    needsApproval: false,
    path: ["mcp"],
    positional: [],
    readOnly: false,
    source: "local",
    summary: "Serve the platform's tools over MCP on stdio.",
  },
  {
    flags: ["--json"],
    needsApproval: false,
    path: ["schema"],
    positional: ["command"],
    readOnly: true,
    source: "local",
    summary: "Print the JSON Schema of a command's payload.",
  },
  {
    contract: "today",
    flags: ["--project", "--tui", "--json"],
    needsApproval: false,
    path: ["today"],
    positional: [],
    readOnly: true,
    source: "local",
    summary:
      "Show your Today: the decisions to take, each with its evidence and a safe default; --tui opens it full-screen at a terminal.",
  },
];

const standIns = new Set(
  localCommandDocs.flatMap(({ contract, path }) =>
    contract === undefined ? [] : [path.join(" ")]
  )
);

const fieldsOf = (ast: SchemaAST.AST) =>
  SchemaAST.isObjects(ast)
    ? ast.propertySignatures.map(({ name }) => String(name))
    : [];

export const contractCommandDocs = (
  group: typeof Contracts
): readonly CommandDoc[] =>
  [...group.requests.values()].flatMap((rpc) => {
    const { annotations } = rpc;
    const cli = Context.get(annotations, Cli);
    const name = cli.name ?? rpc._tag;
    const [first, ...rest] = name.split(" ");

    if (
      first === undefined ||
      !Context.get(annotations, Surfaces).includes("cli") ||
      standIns.has(name)
    ) {
      return [];
    }

    const positional = cli.positional ?? [];
    const readOnly = Context.get(annotations, ReadOnly);
    const needsApproval = Context.get(annotations, NeedsApproval);

    const flags = fieldsOf(rpc.payloadSchema.ast)
      .filter((field) => !positional.includes(field))
      .map((field) => `--${field}`);

    return [
      {
        contract: rpc._tag,
        flags: [
          ...flags,
          "--json",
          ...(needsApproval ? ["--yes"] : []),
          ...(readOnly ? [] : ["--dry-run"]),
        ],
        needsApproval,
        path: [first, ...rest],
        positional: [...positional],
        readOnly,
        source: "contract",
        summary: Context.get(annotations, Description),
      },
    ];
  });

const byWords = Order.mapInput(Order.String, (doc: CommandDoc) =>
  doc.path.join(" ")
);

export const commandDocs = (group: typeof Contracts): readonly CommandDoc[] =>
  Arr.sort([...contractCommandDocs(group), ...localCommandDocs], byWords);
