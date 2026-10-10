/**
 * How an agent connects to the platform, one channel at a time: remote MCP
 * for a client that signs in over OAuth, MCP over stdio through the CLI,
 * the CLI itself, a sentence any agent can be handed, and the skills. Each
 * channel says when to use it and gives the snippets to copy. The web draws
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
import { Array as Arr } from "effect";

import type { CommandDoc } from "./command-doc.ts";
import { mcpServersFor } from "./platform.ts";
import { page, printJson } from "./text.ts";

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
      // The web forwards the CLI's downloads to the platform, as `llms.txt` says.
      text: `curl -fsSL ${webUrl}/install.sh | sh`,
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
      text: `Use ${webUrl}/llms.txt as the source of truth for ${Brand.name}: it says how to take an ask and lists every command and project. Each ask reads as Markdown at ${webUrl}/<project>/asks/<ask>.md.`,
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

const snippetLines = ({ label, language, text }: SetupSnippet) => [
  `${label}:`,
  "",
  `\`\`\`${language}`,
  text,
  "```",
  "",
];

const channelLines = ({ snippets, title, useWhen }: SetupChannel) => [
  `## ${title}`,
  "",
  `Use this when ${useWhen.charAt(0).toLowerCase()}${useWhen.slice(1)}`,
  "",
  ...snippets.flatMap(snippetLines),
];

/** The same channels as one Markdown document: `/agents.md`. */
export const agentSetupMarkdown = (input: SetupInput) =>
  page([
    "# Agents",
    "",
    `> How an agent connects to ${Brand.name}: over MCP, through the CLI, with a sentence to paste, or as skills. Each section says when to use it.`,
    "",
    ...agentSetup(input).flatMap(channelLines),
  ]);
