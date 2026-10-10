/**
 * What an agent, or a person, reads first about a host, as plain Markdown
 * in the `llms.txt` shape (a title, a one-line summary, then sections of
 * links). `frontLlms` says what the platform is, how to install the CLI,
 * how to connect over MCP, how to find and take an ask, every command, and
 * which projects exist: the web serves it at `/llms.txt`, and the platform
 * at `/` for an agent, with no web app's pages named when it knows of none.
 * `projectLlms` is the web's `/<project>/llms.txt`, with the project's open
 * asks, and `mcpCard` its `/.well-known/mcp.json`. With a web app,
 * `frontLlms` names `/llms-full.txt` (`full-llms.ts`), and `indexBanner`
 * opens every other Markdown answer the web serves, so a reader that lands
 * on one finds the rest.
 *
 * Pure: the hosts hand in what the platform lists and the CLI's commands
 * as this package's one list holds them, so no command is written here
 * by hand. A step names a command only when the catalog has it. Every
 * name comes from `Brand`.
 */
import { Brand } from "@repo/brand";
import type { AskListing } from "@repo/protocol/domain/ask";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import type { ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { Array as Arr, Option } from "effect";

import type { CommandDoc } from "./command-doc.ts";

type Command = CommandDoc;

type Commands = readonly CommandDoc[];

/** The MCP protocol the platform serves over HTTP. */
export const MCP_PROTOCOL = "2026-07-28";

/** Each posture as GLOSSARY.md names it. */
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

/** The lines as one document, ending in a newline. */
const page = (lines: readonly string[]) => `${lines.join("\n")}\n`;

/** What a placeholder stands for in a command line, if the page knows it. */
interface Known {
  readonly project?: string;
}

/** The command whose words are `words`, if the catalog has it. */
const commandOf = (commands: Commands, words: string) =>
  Arr.findFirst(commands, ({ path }) => path.join(" ") === words);

/**
 * A command as typed: the CLI's name, its words, its arguments, then
 * `flags` it takes, each with a value the page knows or a placeholder.
 */
const usage = (
  command: Command,
  known: Known = {},
  flags: readonly ("ask" | "project")[] = []
) => {
  const valueOf = (name: string) =>
    name === "project" && known.project !== undefined
      ? known.project
      : `<${name}>`;

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

/** `words` as typed, with `flags`, when the catalog has the command. */
export const typed = (
  commands: Commands,
  words: string,
  known: Known,
  flags: readonly ("ask" | "project")[] = []
) =>
  Option.map(commandOf(commands, words), (command) =>
    code(usage(command, known, flags))
  );

/** The sentence `make` writes around a typed command, or nothing without it. */
export const withCommand = (
  command: Option.Option<string>,
  make: (typedCommand: string) => string
) => Option.toArray(Option.map(command, make));

/**
 * How to take an ask, each step with the commands the catalog has: find,
 * read, claim, change and check, push and read the verdict. Numbered in
 * order, whatever steps the catalog leaves out.
 */
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
    `Push to your fork with ${code(`git push ${Brand.slug} HEAD:main`)}${Option.match(
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

/** What a command row adds to its description. */
const notes = ({ needsApproval, readOnly }: Command) => [
  ...(readOnly ? ["Only reads."] : []),
  ...(needsApproval ? [`Runs only with ${code("--yes")}.`] : []),
];

/** Every command, one line each, in the catalog's order. */
const commandList = (commands: Commands) => [
  "## Commands",
  "",
  ...commands.map(
    (command) =>
      `- ${code(usage(command))}: ${[command.summary, ...notes(command)].join(" ")}`
  ),
  "",
];

/** Where a project's page is on the web host. */
const projectPage = (webUrl: string, project: string) => `${webUrl}/${project}`;

/** What a project's line says of it: its posture and its open asks. */
const projectFacts = (listing: ProjectListing) =>
  `${postureWords[listing.posture]}, ${counted(listing.openAsks, "open ask")}.`;

/**
 * A project's line: a link to its Markdown on the web host, or, with no
 * web app, its clone URL on the platform.
 */
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

/**
 * The platform, the CLI, MCP, taking an ask, the commands and the
 * projects: the web's `/llms.txt`, and the platform's `/` for an agent.
 * Without `webUrl` it names only what the platform serves itself: the CLI
 * and the skills from the platform, each project by its clone URL, and no
 * page that only a web app serves.
 */
export const frontLlms = (input: {
  readonly commands: Commands;
  readonly projects: readonly ProjectListing[];
  readonly platformUrl: string;
  readonly webUrl?: string;
}) => {
  const { commands, platformUrl, projects } = input;
  const webUrl = Option.fromUndefinedOr(input.webUrl);
  // The CLI's downloads and the skills: the web forwards both to the platform.
  const served = Option.getOrElse(webUrl, () => platformUrl);

  return page([
    `# ${Brand.name}`,
    "",
    `> ${Brand.name} is a Git platform where everything a project ships is public. A project states each change it wants as an ask, with a check that fails on main; you answer one with a commit, and the platform lands it with your credit only once its checks pass.`,
    "",
    ...Option.match(webUrl, {
      onNone: () => [],
      onSome: (web) => [
        `The same facts read as Markdown: each project at ${web}/<project>/llms.txt, and each ask at ${web}/<project>/asks/<ask>.md. Every refusal, how git meets the platform, how a landing happens, the events and the guides are in ${web}/llms-full.txt.`,
        "",
      ],
    }),
    "## Install the CLI",
    "",
    "```sh",
    `curl -fsSL ${served}/install.sh | sh`,
    "```",
    "",
    ...Option.match(commandOf(commands, "login"), {
      onNone: () => [],
      onSome: () => [
        "Then sign in once; git pushes to the platform with your token from then on:",
        "",
        "```sh",
        `${Brand.cli} login --url ${platformUrl}`,
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

/** What an ask's line adds after its want: its kind and territory, then whether it can be taken. */
const askNotes = (listing: AskListing) => [
  `Kind ${code(listing.kind)}, territory ${code(listing.territory)}.`,
  ...(listing.claimed ? ["Claimed."] : []),
  ...(listing.reserve === undefined ? [] : [`Held for ${listing.reserve}.`]),
  ...(listing.blockedBy.length === 0
    ? []
    : [`Waits for ${listing.blockedBy.map(code).join(", ")}.`]),
];

/** An ask's want as a sentence of its own, however it was punctuated. */
const sentence = (text: string) => `${text.replace(/[.\s]+$/u, "")}.`;

const askLine = (webUrl: string, project: string, listing: AskListing) =>
  `- [${listing.ask}](${projectPage(webUrl, project)}/asks/${listing.ask}.md): ${[sentence(listing.want), ...askNotes(listing)].join(" ")}`;

/**
 * The line that opens a Markdown answer the web serves: where the index is,
 * where the full text is, and, for a project's answer, the project's own
 * index. One blockquote, so a reader that lands on any page finds the rest.
 */
export const indexBanner = (input: {
  readonly webUrl: string;
  readonly project?: ProjectName;
}) => {
  const { project, webUrl } = input;

  return `> For agents: the index is ${webUrl}/llms.txt, and everything beyond it (refusals, git, landings, events, guides) is ${webUrl}/llms-full.txt${project === undefined ? "" : `; this project's index is ${projectPage(webUrl, project)}/llms.txt`}.`;
};

/** `/<project>/llms.txt`: the project, its posture, how to clone it, its open asks and how to take one. */
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
    indexBanner({ project, webUrl }),
    "",
    `# ${project}`,
    "",
    `> A project on ${Brand.name}. Posture: ${postureWords[listing.posture]}. ${counted(asks.length, "open ask")}.`,
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

/**
 * `/<project>/llms.txt` for a project the platform does not list. A name
 * that could not be a project's is not repeated back.
 */
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

/**
 * `/.well-known/mcp.json`: the platform's MCP endpoint, its transport and
 * protocol, and where a client learns to sign in. No settled standard says
 * this card's shape; it follows the MCP server card draft, and names its
 * authorization the way the platform's 401 does (RFC 9728's
 * `resource_metadata`).
 */
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
