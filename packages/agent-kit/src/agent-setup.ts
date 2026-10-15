import { Brand } from "@repo/brand";
import { PolicyInput } from "@repo/protocol/domain/policy";
import { groups } from "@repo/protocol/refusal";
import { Array as Arr, Schema } from "effect";

import type { CommandDoc } from "./command-doc.ts";
import { installCommand, loginCommand } from "./install.ts";
import { mcpServersFor } from "./platform.ts";
import { span } from "./sections.ts";
import { code, listed, page, printJson, table } from "./text.ts";

export interface SetupSnippet {
  /** A short name, for a tab or a list of choices: "Cursor", "stdio". */
  readonly name: string;
  readonly label: string;
  readonly language: "sh" | "json" | "text";
  readonly text: string;
}

export interface SetupChannel {
  readonly title: string;
  readonly useWhen: string;
  readonly snippets: readonly SetupSnippet[];
}

export interface SetupInput {
  readonly commands: readonly CommandDoc[];
  readonly platformUrl: string;
  readonly webUrl: string;
}

export const hasCommand = (commands: readonly CommandDoc[], words: string) =>
  Arr.some(commands, ({ path }) => path.join(" ") === words);

const json = (value: Parameters<typeof printJson>[0]) =>
  printJson(value).trimEnd();

export const remoteMcp = ({ platformUrl }: SetupInput): SetupChannel => ({
  snippets: [
    {
      label: "Claude Code, then /mcp in a session to sign in",
      language: "sh",
      name: "Claude Code",
      text: `claude mcp add --transport http ${Brand.slug} ${platformUrl}/mcp`,
    },
    {
      label: "Cursor, in .cursor/mcp.json",
      language: "json",
      name: "Cursor",
      text: json({ mcpServers: mcpServersFor(platformUrl, "cursor") }),
    },
    {
      label: "VS Code, in .vscode/mcp.json",
      language: "json",
      name: "VS Code",
      text: json({ servers: mcpServersFor(platformUrl, "claude") }),
    },
  ],
  title: "Remote MCP",
  useWhen: `Your client signs in over OAuth: it opens a browser once, you sign in with your account on ${Brand.name}, and it calls the platform's tools at ${platformUrl}/mcp.`,
});

export const stdioMcp = (): SetupChannel => ({
  snippets: [
    {
      label: "The server's command, once you have signed in with the CLI",
      language: "sh",
      name: "stdio",
      text: `${Brand.cli} mcp`,
    },
  ],
  title: "MCP over stdio",
  useWhen: `Your client starts its MCP servers as local commands, or cannot sign in over OAuth: the CLI serves the same tools over stdio, with the token the CLI stored when you signed in.`,
});

/** The install script's snippet, the CLI's first step on `/agents.md` and the Install page alike. */
export const installScript = ({
  webUrl,
}: Pick<SetupInput, "webUrl">): SetupSnippet => ({
  label: "Install",
  language: "sh",
  name: "Install script",
  text: installCommand(webUrl),
});

/** Signing in with the CLI, once its commands have `login`; none otherwise. */
export const signIn = ({
  commands,
  platformUrl,
}: Pick<SetupInput, "commands" | "platformUrl">): readonly SetupSnippet[] =>
  hasCommand(commands, "login")
    ? [
        {
          label: "Sign in once; git pushes with your token from then on",
          language: "sh",
          name: "Sign in",
          text: loginCommand(platformUrl),
        },
      ]
    : [];

export const theCli = (input: SetupInput): SetupChannel => ({
  snippets: [installScript(input), ...signIn(input)],
  title: "The CLI",
  useWhen: `Your agent has a shell: it finds and claims asks, checks an answer before it pushes and reads verdicts with the CLI, and pushes with git.`,
});

export const anyAgent = ({ webUrl }: SetupInput): SetupChannel => ({
  snippets: [
    {
      label: "Paste into the agent's prompt",
      language: "text",
      name: "Prompt",
      text: `Use ${webUrl}/llms.txt as the source of truth for ${Brand.name}: it says how to take an ask and lists every command and project. Each ask reads as Markdown at ${webUrl}/<owner>/<name>/asks/<ask>.md.`,
    },
  ],
  title: "Text for any agent",
  useWhen:
    "Your agent can fetch a URL but has no MCP client or CLI set up: hand it the platform's index and it reads the rest as Markdown.",
});

export const skills = ({ webUrl }: SetupInput): SetupChannel => ({
  snippets: [
    {
      label: "Add every project's contribute skill",
      language: "sh",
      name: "Skills",
      text: `npx skills add ${webUrl}`,
    },
  ],
  title: "Skills",
  useWhen: `Your agent loads skills: each project's contribute skill is listed, with its digest, at ${webUrl}/.well-known/agent-skills/index.json.`,
});

export const agentSetup = (input: SetupInput): readonly SetupChannel[] => [
  remoteMcp(input),
  ...(hasCommand(input.commands, "mcp") ? [stdioMcp()] : []),
  theCli(input),
  anyAgent(input),
  skills(input),
];

export interface SynopsisLine {
  readonly usage: string;
  readonly summary: string;
}

/** One command as the synopsis writes it: its words, positionals, then optional flags. */
export const synopsisLine = ({
  flags,
  path,
  positional,
  summary,
}: CommandDoc): SynopsisLine => ({
  summary,
  usage: [
    Brand.cli,
    ...path,
    ...positional.map((name) => `<${name}>`),
    ...flags
      .filter((flag) => !positional.includes(flag.replace(/^--/u, "")))
      .map((flag) => `[${flag}]`),
  ].join(" "),
});

export const synopsis = (
  commands: readonly CommandDoc[]
): readonly SynopsisLine[] => commands.map((command) => synopsisLine(command));

export interface Endpoint {
  readonly url: string;
  readonly what: string;
  readonly readable: boolean;
}

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
    what: "Setup, the endpoints, the limits and the refusals as one Markdown file.",
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

export interface Limit {
  readonly limit: string;
  readonly value: string;
}

const policyDefaults = () =>
  Schema.decodeSync(
    Schema.Struct({
      caps: PolicyInput.fields.caps,
      claims: PolicyInput.fields.claims,
      decisions: PolicyInput.fields.decisions,
    })
  )({});

export const agentLimits = (): readonly Limit[] => {
  const { caps, claims, decisions } = policyDefaults();

  return [
    {
      limit:
        "Claims one person nobody has vouched for holds at once, in a project",
      value: `${caps.claimsPerPerson} by default; a vouched person and a maintainer are never held`,
    },
    {
      limit:
        "Open proposals one person nobody has vouched for holds, in a project",
      value: `${caps.proposalsPerPerson} by default; 0 turns proposals off`,
    },
    {
      limit: "A claim without a push",
      value: `Warned after ${span(claims.warnAfterMs)}, lapses after ${span(claims.lapseAfterMs)}, by default`,
    },
    {
      limit: "A decision nobody takes",
      value: `${span(decisions.expireDays * 86_400_000)} by default, then it takes its default`,
    },
    {
      limit: "Claims, proposals and drafts across the platform, per person",
      value:
        "A set number a minute; past it, CapReached says when to try again",
    },
  ];
};

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

/** The endpoints as a section, for `/agents.md` and the docs' Limits and endpoints page alike: one a reader can open is a link, a template or a protocol's address is not. */
export const endpointLines = (
  input: Pick<SetupInput, "platformUrl" | "webUrl">
) => [
  "## Endpoints",
  "",
  ...table(
    ["Address", "What it is"],
    agentEndpoints(input).map(({ readable, url, what }) => [
      readable ? `[${code(url)}](${url})` : code(url),
      what,
    ])
  ),
  "",
];

/** The limits as a section, for `/agents.md` and the docs' Limits and endpoints page alike. */
export const limitLines = () => [
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
