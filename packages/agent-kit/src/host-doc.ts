import { Brand } from "@repo/brand";
import type { AskListing } from "@repo/protocol/domain/ask";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import type { ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { Array as Arr, Option } from "effect";

import type { CommandDoc } from "./command-doc.ts";
import { installCommand, loginCommand, pushCommand } from "./install.ts";

type Command = CommandDoc;

type Commands = readonly CommandDoc[];

export const MCP_PROTOCOL = "2026-07-28";

const postureWords = {
  open: "Open",
  openCore: "Open core",
  openOnSchedule: "Open on schedule",
  openWithSealedEvidence: "Open with sealed evidence",
  sourceAvailable: "Source available",
} as const satisfies Record<Posture, string>;

const code = (text: string) => `\`${text}\``;

const counted = (count: number, one: string) =>
  `${count} ${one}${count === 1 ? "" : "s"}`;

const page = (lines: readonly string[]) => `${lines.join("\n")}\n`;

interface Known {
  readonly project?: string;
}

const commandOf = (commands: Commands, words: string) =>
  Arr.findFirst(commands, ({ path }) => path.join(" ") === words);

const usage = (
  command: Command,
  known: Known = {},
  flags: readonly ("ask" | "project")[] = []
) => {
  const valueOf = (name: string) =>
    name === "project" ? (known.project ?? "<owner>/<name>") : `<${name}>`;

  return [
    Brand.cli,
    ...command.path,
    ...command.positional.map((name) => `<${name}>`),
    ...flags.flatMap((flag) =>
      command.flags.includes(`--${flag}`) && !command.positional.includes(flag)
        ? [`--${flag}`, valueOf(flag)]
        : []
    ),
  ].join(" ");
};

export const typed = (
  commands: Commands,
  words: string,
  known: Known,
  flags: readonly ("ask" | "project")[] = []
) =>
  Option.map(commandOf(commands, words), (command) =>
    code(usage(command, known, flags))
  );

export const withCommand = (
  command: Option.Option<string>,
  make: (typedCommand: string) => string
) => Option.toArray(Option.map(command, make));

const takeAnAsk = (commands: Commands, known: Known) => {
  const front = typed(commands, "front", known);
  const asks = typed(commands, "asks", known, ["project"]);

  const find = [
    ...Option.toArray(
      Option.map(front, (each) => `${each} lists the open asks across projects`)
    ),
    ...Option.toArray(
      Option.map(asks, (each) => `${each} lists one project's`)
    ),
  ];

  const steps = [
    ...(find.length === 0 ? [] : [`Find one: ${find.join("; ")}.`]),
    ...withCommand(
      typed(commands, "ask", known, ["project"]),
      (each) => `Read it: ${each}.`
    ),
    ...withCommand(
      typed(commands, "claim", known, ["project"]),
      (each) =>
        `Claim it: ${each}. The claim prints your fork's remote; add it with ${code(`git remote add ${Brand.slug} <remote>`)}.`
    ),
    ...withCommand(
      typed(commands, "check", known),
      (each) =>
        `Change only the ask's territory, then run ${each} and fix everything it reports.`
    ),
    `Push to your fork with ${code(pushCommand)}${Option.match(
      typed(commands, "verdict", known, ["ask", "project"]),
      { onNone: () => "", onSome: (each) => `, then read the verdict: ${each}` }
    )}. A refusal names the command to run next.`,
  ];

  return [
    "## Take an ask",
    "",
    ...steps.map((step, at) => `${at + 1}. ${step}`),
    "",
  ];
};

const notes = ({ needsApproval, readOnly }: Command) => [
  ...(readOnly ? ["Only reads."] : []),
  ...(needsApproval ? [`Runs only with ${code("--yes")}.`] : []),
];

const commandList = (commands: Commands) => [
  "## Commands",
  "",
  ...commands.map(
    (command) =>
      `- ${code(usage(command))}: ${[command.summary, ...notes(command)].join(" ")}`
  ),
  "",
];

const projectPage = (webUrl: string, project: string) => `${webUrl}/${project}`;

const projectFacts = (listing: ProjectListing) =>
  `${postureWords[listing.posture]}, ${counted(listing.openAsks, "open ask")}.`;

const projectLine = (
  platformUrl: string,
  webUrl: Option.Option<string>,
  listing: ProjectListing
) =>
  Option.match(webUrl, {
    onNone: () =>
      `- ${listing.project}: ${projectFacts(listing)} Clone: ${code(`git clone ${platformUrl}/${listing.project}.git`)}.`,
    onSome: (web) =>
      `- [${listing.project}](${projectPage(web, listing.project)}/llms.txt): ${projectFacts(listing)}`,
  });

export const frontLlms = (input: {
  readonly commands: Commands;
  readonly projects: readonly ProjectListing[];
  readonly platformUrl: string;
  readonly webUrl?: string;
}) => {
  const { commands, platformUrl, projects } = input;
  const webUrl = Option.fromUndefinedOr(input.webUrl);
  const served = Option.getOrElse(webUrl, () => platformUrl);

  return page([
    `# ${Brand.name}`,
    "",
    `> ${Brand.name} is a Git platform where everything a project ships is public. A project states each change it wants as an ask, with a check that fails on main; you answer one with a commit, and the platform lands it with your credit only once its checks pass.`,
    "",
    ...Option.match(webUrl, {
      onNone: () => [],
      onSome: (web) => [
        `The same facts read as Markdown: each project at ${web}/<owner>/<name>/llms.txt, and each ask at ${web}/<owner>/<name>/asks/<ask>.md. Every refusal, how git meets the platform, how a landing happens, the events and the guides are in ${web}/llms-full.txt.`,
        "",
        `Guides and a reference written for people are at ${web}/docs, each page also as Markdown at ${web}/docs/<page>.md.`,
        "",
      ],
    }),
    "## Install the CLI",
    "",
    "```sh",
    installCommand(served),
    "```",
    "",
    ...Option.match(commandOf(commands, "login"), {
      onNone: () => [],
      onSome: () => [
        "Then sign in once; git pushes to the platform with your token from then on:",
        "",
        "```sh",
        loginCommand(platformUrl),
        "```",
        "",
      ],
    }),
    "## Connect over MCP",
    "",
    `- Endpoint: ${platformUrl}/mcp (streamable HTTP, MCP ${MCP_PROTOCOL})${Option.match(
      webUrl,
      {
        onNone: () => "",
        onSome: (web) => `, described at ${web}/.well-known/mcp.json`,
      }
    )}.`,
    `- Auth: a bearer token from the platform's own OAuth server, which an MCP client finds at ${platformUrl}/.well-known/oauth-protected-resource; you sign in with your account on ${Brand.name}.`,
    ...withCommand(
      typed(commands, "mcp", {}),
      (each) =>
        `- Without a client that signs in: ${each} serves the same tools over stdio, with the token ${code(`${Brand.cli} login`)} stored.`
    ),
    `- Skills: ${served}/.well-known/agent-skills/index.json lists each project's contribute skill, with its digest.`,
    "",
    ...takeAnAsk(commands, {}),
    ...commandList(commands),
    "## Projects",
    "",
    ...(projects.length === 0
      ? ["No project is on the platform yet."]
      : projects.map((listing) => projectLine(platformUrl, webUrl, listing))),
  ]);
};

const askNotes = (listing: AskListing) => [
  `Kind ${code(listing.kind)}, territory ${code(listing.territory)}.`,
  ...(listing.claimed ? ["Claimed."] : []),
  ...(listing.reserve === undefined ? [] : [`Held for ${listing.reserve}.`]),
  ...(listing.blockedBy.length === 0
    ? []
    : [`Waits for ${listing.blockedBy.map(code).join(", ")}.`]),
];

const sentence = (text: string) => `${text.replace(/[.\s]+$/u, "")}.`;

const askLine = (webUrl: string, project: string, listing: AskListing) =>
  `- [${listing.ask}](${projectPage(webUrl, project)}/asks/${listing.ask}.md): ${[sentence(listing.want), ...askNotes(listing)].join(" ")}`;

export const indexBanner = (input: {
  readonly webUrl: string;
  readonly project?: ProjectName;
}) => {
  const { project, webUrl } = input;

  return `> For agents: the index is ${webUrl}/llms.txt, and everything beyond it (refusals, git, landings, events, guides) is ${webUrl}/llms-full.txt${project === undefined ? "" : `; this project's index is ${projectPage(webUrl, project)}/llms.txt`}.`;
};

export const underTitle = (text: string, banner: string) => {
  const end = text.indexOf("\n");

  return text.startsWith("# ") && end !== -1
    ? `${text.slice(0, end)}\n\n${banner}\n\n${text.slice(end).replace(/^\n+/u, "")}`
    : `${banner}\n\n${text}`;
};

export const projectLlms = (input: {
  readonly listing: ProjectListing;
  readonly asks: readonly AskListing[];
  readonly commands: Commands;
  readonly platformUrl: string;
  readonly webUrl: string;
}) => {
  const { asks, commands, listing, platformUrl, webUrl } = input;
  const { project } = listing;

  return page([
    `# ${project}`,
    "",
    `> A project on ${Brand.name}. Posture: ${postureWords[listing.posture]}. ${counted(asks.length, "open ask")}.`,
    "",
    indexBanner({ project, webUrl }),
    "",
    `- Page: ${projectPage(webUrl, project)}`,
    `- Clone: ${code(`git clone ${platformUrl}/${project}.git`)}`,
    `- Everything else, and every command: ${webUrl}/llms.txt`,
    "",
    "## Open asks",
    "",
    ...(asks.length === 0
      ? ["No ask is open."]
      : asks.map((each) => askLine(webUrl, project, each))),
    "",
    ...takeAnAsk(commands, { project }).slice(0, -1),
  ]);
};

export const missingProjectLlms = (input: {
  readonly project: Option.Option<ProjectName>;
  readonly webUrl: string;
}) =>
  page([
    "# Not found",
    "",
    `${Option.match(input.project, {
      onNone: () => "No such project",
      onSome: (project) => `No project named ${code(project)}`,
    })} is on ${Brand.name}. Every project is listed at ${input.webUrl}/llms.txt.`,
  ]);

// No settled standard gives this card's shape: it follows the MCP server card
// draft, naming its authorization as RFC 9728's `resource_metadata`.
export const mcpCard = (input: { readonly platformUrl: string }) => ({
  authentication: {
    required: true,
    resource_metadata: `${input.platformUrl}/.well-known/oauth-protected-resource`,
    schemes: ["bearer"],
  },
  capabilities: { prompts: {}, resources: {}, tools: {} },
  description: `The contracts of ${Brand.name} as MCP tools, each ask's brief as a resource, and the contribute skill as a prompt.`,
  name: Brand.name,
  protocolVersion: MCP_PROTOCOL,
  transport: { endpoint: `${input.platformUrl}/mcp`, type: "streamable-http" },
});

export type McpCard = ReturnType<typeof mcpCard>;
