// Claude Code reads `.claude-plugin/plugin.json`, `.mcp.json` and
// `hooks/hooks.json`; Agent Plugins 1.0 reads `plugin.json` and `mcp.json`.
// No path is read by both, so the two manifests share one directory.
import { Brand } from "@repo/brand";
import { Array as Arr, Effect, Option, Order } from "effect";

import type { CommandDoc } from "./command-doc.ts";
import { frontmatter } from "./generated-file.ts";
import type { GeneratedFile } from "./generated-file.ts";
import { claudeHooks } from "./hook-events.ts";
import { refusalSection } from "./refusals.ts";
import { loopSteps, unfencedSection } from "./sections.ts";
import { code, page, printJson, table } from "./text.ts";

export interface PlatformInput {
  readonly commands: readonly CommandDoc[];
  readonly platformUrl?: string;
}

const SKILL = `skills/${Brand.slug}/SKILL.md`;

const PLUGIN = `plugins/${Brand.slug}`;

const description = `Contribute to projects on ${Brand.name} with the \`${Brand.cli}\` CLI: find an ask, claim it, check your answer locally, push it to your fork, and read the verdict. Use when a repo's remote is on ${Brand.name}, or when a push was refused with a refusal such as OutOfScope or StaleBase.`;

const usage = ({ path, positional }: CommandDoc) =>
  code(
    [Brand.cli, ...path, ...positional.map((name) => `<${name}>`)].join(" ")
  );

const notes = ({ needsApproval, readOnly }: CommandDoc) =>
  [
    ...(readOnly ? ["Only reads."] : []),
    ...(needsApproval ? ["Runs only with `--yes`."] : []),
  ].join(" ");

const byWords = Order.mapInput(Order.String, (command: CommandDoc) =>
  command.path.join(" ")
);

const commandsSection = (commands: readonly CommandDoc[]) => [
  "## Commands",
  "",
  ...table(
    ["Command", "Flags", "What it does"],
    Arr.sort(commands, byWords).map((command) => [
      usage(command),
      command.flags.map(code).join(" "),
      [command.summary, notes(command)].filter((text) => text !== "").join(" "),
    ])
  ),
  "",
];

const mcpSection = (platformUrl: string | undefined) => [
  "## MCP",
  "",
  platformUrl === undefined
    ? `${code(`${Brand.cli} mcp`)} serves the platform's contracts as MCP tools over stdio, with your stored token.`
    : `The platform serves its contracts as MCP tools at ${code(`${platformUrl}/mcp`)}; ${code(`${Brand.cli} mcp`)} serves the same tools over stdio, with your stored token.`,
  "",
];

const platformBody = (input: PlatformInput) =>
  page([
    `# ${Brand.name}`,
    "",
    `${Brand.name} is a git platform where a change lands only by passing a typed gate. A project states each change it wants as an ask; you answer one with a commit pushed to your claim's fork, and the platform checks it and lands it, or answers with refusals that say what to do next.`,
    "",
    "## The loop",
    "",
    `Find an ask with ${code(`${Brand.cli} asks`)}, then, in the project's repo:`,
    "",
    ...loopSteps(),
    "",
    `A project's own \`<key>-contribute\` skill (its key: the name with each \`/\` as \`__\`, as in \`oscabriel__foo-contribute\`, or for a project made before owners its old one-word key, as in \`datekit-contribute\`) and the block in its AGENTS.md give its territories, its run block and its ask kinds.`,
    "",
    "## Output",
    "",
    "A command whose flags list `--json` prints Markdown, or one versioned JSON envelope with `--json`. A command that needs a person's approval runs only with `--yes`, and `--dry-run` prints what it would send.",
    "",
    ...commandsSection(input.commands),
    ...mcpSection(input.platformUrl),
    ...refusalSection(),
    ...unfencedSection(),
  ]);

// Synchronous: the platform builds the prompt at module load, where nothing
// may be awaited, and `SKILL.md`'s hash is a WebCrypto promise.
export const platformSkillParts = (input: PlatformInput) => ({
  body: platformBody(input),
  description,
  name: Brand.slug,
});

const skillFile = (input: PlatformInput) =>
  frontmatter({ ...platformSkillParts(input), landed: Option.none() });

export const platformSkill = (
  input: PlatformInput
): Effect.Effect<readonly GeneratedFile[]> =>
  skillFile(input).pipe(Effect.map((content) => [{ content, path: SKILL }]));

// Cursor's remote entry is a bare `url`: its docs give a `type` only for stdio.
const servers = {
  "agent-plugins": {
    remote: (url: string) => ({ type: "streamable-http", url }),
    stdio: { args: ["mcp"], command: Brand.cli, type: "stdio" },
  },
  claude: {
    remote: (url: string) => ({ type: "http", url }),
    stdio: { args: ["mcp"], command: Brand.cli },
  },
  cursor: {
    remote: (url: string) => ({ url }),
    stdio: { args: ["mcp"], command: Brand.cli, type: "stdio" },
  },
} as const;

export type McpFlavour = keyof typeof servers;

export const mcpServersFor = (
  platformUrl: string | undefined,
  flavour: McpFlavour
) => ({
  [Brand.slug]:
    platformUrl === undefined
      ? servers[flavour].stdio
      : servers[flavour].remote(`${platformUrl}/mcp`),
});

const hooksJson = () => printJson(claudeHooks());

const pluginDescription = `The ${Brand.name} CLI's skill, MCP server and hooks: the gate's scope guard before an edit, the claimed ask's brief at the start, and its verdict before you stop.`;

const homepage = (platformUrl: string | undefined) =>
  platformUrl === undefined ? {} : { homepage: platformUrl };

export const claudePlugin = (
  input: PlatformInput
): Effect.Effect<readonly GeneratedFile[]> =>
  skillFile(input).pipe(
    Effect.map((skill) => [
      {
        content: printJson({
          description: pluginDescription,
          name: Brand.slug,
          ...homepage(input.platformUrl),
        }),
        path: `${PLUGIN}/.claude-plugin/plugin.json`,
      },
      { content: skill, path: `${PLUGIN}/${SKILL}` },
      {
        content: printJson({
          mcpServers: mcpServersFor(input.platformUrl, "claude"),
        }),
        path: `${PLUGIN}/.mcp.json`,
      },
      { content: hooksJson(), path: `${PLUGIN}/hooks/hooks.json` },
    ])
  );

const SCHEMAS = "https://agent-plugins.org/schemas/1.0.0";

export const agentPluginsBundle = (
  input: PlatformInput
): Effect.Effect<readonly GeneratedFile[]> =>
  skillFile(input).pipe(
    Effect.map((skill) => [
      {
        content: printJson({
          $schema: `${SCHEMAS}/plugin.schema.json`,
          description: `The ${Brand.name} CLI's skill and MCP server: find an ask, claim it, check your answer locally, push it, and read the verdict.`,
          name: Brand.slug,
          ...homepage(input.platformUrl),
        }),
        path: `${PLUGIN}/plugin.json`,
      },
      { content: skill, path: `${PLUGIN}/${SKILL}` },
      {
        content: printJson({
          $schema: `${SCHEMAS}/mcp.schema.json`,
          mcpServers: mcpServersFor(input.platformUrl, "agent-plugins"),
        }),
        path: `${PLUGIN}/mcp.json`,
      },
    ])
  );
