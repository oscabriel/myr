/**
 * How an agent reaches the platform, set as a reference: a synopsis of the
 * CLI's commands; the channels it connects through (remote MCP for a client
 * that signs in over OAuth, MCP over stdio through the CLI, the CLI itself,
 * a sentence any agent can be handed, and the skills), each saying when to
 * use it and giving the snippets to copy; the endpoints an agent reads; the
 * limits a project's policy sets by default; and the refusals. The web draws
 * it as `/agents` and serves `agentSetupMarkdown` as `/agents.md`.
 *
 * Pure: the hosts hand in the CLI's commands as this package's one list
 * holds them and the two hosts' URLs. Each client's MCP JSON comes from
 * `mcpServersFor`, the builder the plugin bundles use, and every name from
 * `Brand`, the MCP server's name being `Brand.slug`.
 *
 * Client facts, as each client's docs give them: Claude Code adds a remote
 * server with `claude mcp add --transport http <name> <url>` and signs in
 * from `/mcp`; Cursor reads `.cursor/mcp.json`'s `mcpServers`, a remote
 * entry being its `url`; VS Code reads `.vscode/mcp.json`'s `servers`, a
 * remote entry being `{type: "http", url}`.
 */
import { Brand } from "@repo/brand";
import { PolicyInput } from "@repo/protocol/domain/policy";
import { groups } from "@repo/protocol/refusal";
import { Array as Arr, Schema } from "effect";

import type { CommandDoc } from "./command-doc.ts";
import { installCommand } from "./install.ts";
import { mcpServersFor } from "./platform.ts";
import { span } from "./sections.ts";
import { code, listed, page, printJson, table } from "./text.ts";

export interface SetupSnippet {
  /** What the snippet is, or where it goes: a client, a file. */
  readonly label: string;
  readonly language: "sh" | "json" | "text";
  /** The text to copy, whole, with no trailing newline. */
  readonly text: string;
}

export interface SetupChannel {
  readonly title: string;
  /** One plain sentence, no Markdown: the agent this channel is for. */
  readonly useWhen: string;
  readonly snippets: readonly SetupSnippet[];
}

export interface SetupInput {
  /** Every CLI command, as `commandDocs` lists them. */
  readonly commands: readonly CommandDoc[];
  /** The platform's origin: its MCP endpoint and the CLI's sign-in. */
  readonly platformUrl: string;
  /** The web's origin: its Markdown, the CLI's downloads and the skills. */
  readonly webUrl: string;
}

/** Whether the CLI has the command whose words are `words`. */
const has = (commands: readonly CommandDoc[], words: string) =>
  Arr.some(commands, ({ path }) => path.join(" ") === words);

/** JSON as a snippet holds it: the generators' printing, without its final newline. */
const json = (value: Parameters<typeof printJson>[0]) =>
  printJson(value).trimEnd();

const remoteMcp = ({ platformUrl }: SetupInput): SetupChannel => ({
  snippets: [
    {
      label: "Claude Code, then /mcp in a session to sign in",
      language: "sh",
      text: `claude mcp add --transport http ${Brand.slug} ${platformUrl}/mcp`,
    },
    {
      label: "Cursor, in .cursor/mcp.json",
      language: "json",
      text: json({ mcpServers: mcpServersFor(platformUrl, "cursor") }),
    },
    {
      label: "VS Code, in .vscode/mcp.json",
      language: "json",
      text: json({ servers: mcpServersFor(platformUrl, "claude") }),
    },
  ],
  title: "Remote MCP",
  useWhen: `Your client signs in over OAuth: it opens a browser once, you sign in with your account on ${Brand.name}, and it calls the platform's tools at ${platformUrl}/mcp.`,
});

const stdioMcp = (): SetupChannel => ({
  snippets: [
    {
      label: "The server's command, once you have signed in with the CLI",
      language: "sh",
      text: `${Brand.cli} mcp`,
    },
  ],
  title: "MCP over stdio",
  useWhen: `Your client starts its MCP servers as local commands, or cannot sign in over OAuth: the CLI serves the same tools over stdio, with the token the CLI stored when you signed in.`,
});

const theCli = ({
  commands,
  platformUrl,
  webUrl,
}: SetupInput): SetupChannel => ({
  snippets: [
    {
      label: "Install",
      language: "sh",
      text: installCommand(webUrl),
    },
    ...(has(commands, "login")
      ? [
          {
            label: "Sign in once; git pushes with your token from then on",
            language: "sh" as const,
            text: `${Brand.cli} login --url ${platformUrl}`,
          },
        ]
      : []),
  ],
  title: "The CLI",
  useWhen: `Your agent has a shell: it finds and claims asks, checks an answer before it pushes and reads verdicts with the CLI, and pushes with git.`,
});

const anyAgent = ({ webUrl }: SetupInput): SetupChannel => ({
  snippets: [
    {
      label: "Paste into the agent's prompt",
      language: "text",
      text: `Use ${webUrl}/llms.txt as the source of truth for ${Brand.name}: it says how to take an ask and lists every command and project. Each ask reads as Markdown at ${webUrl}/<owner>/<name>/asks/<ask>.md.`,
    },
  ],
  title: "Text for any agent",
  useWhen:
    "Your agent can fetch a URL but has no MCP client or CLI set up: hand it the platform's index and it reads the rest as Markdown.",
});

const skills = ({ webUrl }: SetupInput): SetupChannel => ({
  snippets: [
    {
      label: "Add every project's contribute skill",
      language: "sh",
      text: `npx skills add ${webUrl}`,
    },
  ],
  title: "Skills",
  useWhen: `Your agent loads skills: each project's contribute skill is listed, with its digest, at ${webUrl}/.well-known/agent-skills/index.json.`,
});

/** Every channel, in the order the page shows them; stdio only when the CLI has `mcp`. */
export const agentSetup = (input: SetupInput): readonly SetupChannel[] => [
  remoteMcp(input),
  ...(has(input.commands, "mcp") ? [stdioMcp()] : []),
  theCli(input),
  anyAgent(input),
  skills(input),
];

// --- Synopsis -------------------------------------------------------------------

/** One command as a synopsis gives it: how it is typed, and what it does. */
export interface SynopsisLine {
  /** The CLI's name, its words, its arguments, then each flag it takes in brackets. */
  readonly usage: string;
  readonly summary: string;
}

/** Every command, one line each, in the catalog's order. */
export const synopsis = (
  commands: readonly CommandDoc[]
): readonly SynopsisLine[] =>
  commands.map(({ flags, path, positional, summary }) => ({
    summary,
    usage: [
      Brand.cli,
      ...path,
      ...positional.map((name) => `<${name}>`),
      ...flags
        .filter((flag) => !positional.includes(flag.replace(/^--/u, "")))
        .map((flag) => `[${flag}]`),
    ].join(" "),
  }));

// --- Endpoints ------------------------------------------------------------------

/** One address an agent reads or calls. */
export interface Endpoint {
  /** The address whole; `<…>` marks a part the reader fills in. */
  readonly url: string;
  readonly what: string;
  /** A plain GET in a browser shows it. */
  readonly readable: boolean;
}

/** Every address an agent reads, the web's first, then the platform's. */
export const agentEndpoints = ({
  platformUrl,
  webUrl,
}: Pick<SetupInput, "platformUrl" | "webUrl">): readonly Endpoint[] => [
  {
    readable: true,
    url: `${webUrl}/llms.txt`,
    what: "The index: how to take an ask, every command and every project.",
  },
  {
    readable: true,
    url: `${webUrl}/llms-full.txt`,
    what: "The rest in one file: every refusal, git here, how a landing happens, the events a watcher hears.",
  },
  {
    readable: false,
    url: `${webUrl}/<owner>/<name>/llms.txt`,
    what: "One project: its posture, how to clone it and its open asks.",
  },
  {
    readable: false,
    url: `${webUrl}/<owner>/<name>/asks/<ask>.md`,
    what: "One ask's brief as Markdown.",
  },
  {
    readable: true,
    url: `${webUrl}/agents.md`,
    what: "This reference as Markdown.",
  },
  {
    readable: true,
    url: `${webUrl}/.well-known/mcp.json`,
    what: "The MCP server's card: its endpoint, transport and protocol, and how to sign in.",
  },
  {
    readable: true,
    url: `${webUrl}/.well-known/agent-skills/index.json`,
    what: "Every project's contribute skill, with its digest.",
  },
  {
    readable: false,
    url: `${platformUrl}/mcp`,
    what: "MCP over streamable HTTP, signed in over OAuth.",
  },
  {
    readable: false,
    url: `${platformUrl}/<repo>.git`,
    what: "Git over smart HTTP: clone a project, push an answer to your fork.",
  },
];

// --- Limits ---------------------------------------------------------------------

/** One limit and its value, as a person says them. */
export interface Limit {
  readonly limit: string;
  readonly value: string;
}

/** What a policy that sets nothing takes: the defaults its schema fills in. */
const policyDefaults = () =>
  Schema.decodeSync(
    Schema.Struct({
      budget: PolicyInput.fields.budget,
      caps: PolicyInput.fields.caps,
      claims: PolicyInput.fields.claims,
    })
  )({});

/**
 * The limits an agent meets: each project's policy may set its own, so the
 * values are the defaults; the platform's own rate limits stand in front.
 */
export const agentLimits = (): readonly Limit[] => {
  const { budget, caps, claims } = policyDefaults();

  return [
    {
      limit: "Claims one person holds at once, in a project",
      value: `${caps.claimsPerPerson} by default`,
    },
    {
      limit: "Open proposals one person holds, in a project",
      value: `${caps.proposalsPerPerson} by default; 0 turns proposals off`,
    },
    {
      limit: "A claim without a push",
      value: `Warned after ${span(claims.warnAfterMs)}, lapses after ${span(claims.lapseAfterMs)}, by default`,
    },
    {
      limit: "Decisions a decider takes a day",
      value: `${budget.decisionsPerDay} by default`,
    },
    {
      limit: "A decision nobody takes",
      value: `${span(budget.expireDays * 86_400_000)} by default, then it takes its default`,
    },
    {
      limit: "Claims, proposals and drafts across the platform, per person",
      value:
        "A set number a minute; past it, CapReached says when to try again",
    },
  ];
};

// --- Markdown -------------------------------------------------------------------

const snippetLines = ({ label, language, text }: SetupSnippet) => [
  `${label}:`,
  "",
  `\`\`\`${language}`,
  text,
  "```",
  "",
];

const channelLines = ({ snippets, title, useWhen }: SetupChannel) => [
  `### ${title}`,
  "",
  `Use this when ${useWhen.charAt(0).toLowerCase()}${useWhen.slice(1)}`,
  "",
  ...snippets.flatMap(snippetLines),
];

const synopsisLines = (commands: readonly CommandDoc[]) => [
  "## Synopsis",
  "",
  ...synopsis(commands).map(
    ({ summary, usage }) => `- ${code(usage)}: ${summary}`
  ),
  "",
];

const endpointLines = (input: SetupInput) => [
  "## Endpoints",
  "",
  ...table(
    ["Address", "What it is"],
    agentEndpoints(input).map(({ url, what }) => [code(url), what])
  ),
  "",
];

const limitLines = () => [
  "## Limits",
  "",
  ...table(
    ["Limit", "Value"],
    agentLimits().map(({ limit, value }) => [limit, value])
  ),
  "",
];

const refusalLines = ({ webUrl }: SetupInput) => [
  "## Refusals",
  "",
  `Every refusal the platform gives, by group. Each one's row in ${webUrl}/llms-full.txt says whether retrying helps, its \`next\` and what to do.`,
  "",
  ...groups.map(
    ({ members, name }) =>
      `- ${name}: ${listed(members.map((member) => code(member.identifier)))}`
  ),
  "",
];

/** The whole reference as one Markdown document: `/agents.md`. */
export const agentSetupMarkdown = (input: SetupInput) =>
  page([
    "# For agents",
    "",
    `> How an agent reaches ${Brand.name}: the CLI's commands, the ways to connect (over MCP, through the CLI, with a sentence to paste, or as skills), the endpoints, the limits and the refusals.`,
    "",
    ...synopsisLines(input.commands),
    "## Connect",
    "",
    ...agentSetup(input).flatMap(channelLines),
    ...endpointLines(input),
    ...limitLines(),
    ...refusalLines(input),
  ]);
