/**
 * The repo's own `skills/<slug>/` and `plugins/<slug>/`, which `bun run gen`
 * writes (issue 409): the platform's skill, the Claude Code plugin with its
 * three hooks, and the Agent Plugins bundle. The plugin is what a person
 * installs, so it is the only place executable hooks ship; a project's own
 * generated files are data.
 *
 * Both plugin manifests share one directory: Claude Code reads
 * `.claude-plugin/plugin.json`, `.mcp.json` and `hooks/hooks.json`, Agent
 * Plugins 1.0 reads `plugin.json` and `mcp.json`, and both read `skills/`.
 * No path is read by both, so neither manifest overrides the other.
 */
import { Brand } from "@repo/brand";
import { Array as Arr, Effect, Option, Order } from "effect";

import type { CommandDoc } from "./command-doc.ts";
import { frontmatter } from "./generated-file.ts";
import type { GeneratedFile } from "./generated-file.ts";
import { claudeEventOf, guardedTools, HookEvent } from "./hook-events.ts";
import { refusalSection } from "./refusals.ts";
import { loopSteps, unfencedSection } from "./sections.ts";
import { code, page, printJson, table } from "./text.ts";

export interface PlatformInput {
  /** Every CLI command, as `docs/reference/commands.json` lists them. */
  readonly commands: readonly CommandDoc[];
  /** The platform's origin, for its MCP endpoint; without it, MCP runs through the CLI. */
  readonly platformUrl?: string;
}

const SKILL = `skills/${Brand.slug}/SKILL.md`;

const PLUGIN = `plugins/${Brand.slug}`;

// --- The platform's skill ------------------------------------------------------

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
    `A project's own \`<project>-contribute\` skill and the block in its AGENTS.md give its territories, its run block and its ask kinds.`,
    "",
    "## Output",
    "",
    "Every command prints Markdown; `--json` prints one versioned JSON envelope instead. A command that needs a person's approval runs only with `--yes`, and `--dry-run` prints what it would send.",
    "",
    ...commandsSection(input.commands),
    ...mcpSection(input.platformUrl),
    ...refusalSection(),
    ...unfencedSection(),
  ]);

const skillFile = (input: PlatformInput) =>
  frontmatter({
    body: platformBody(input),
    description,
    landed: Option.none(),
    name: Brand.slug,
  });

/** `skills/<slug>/SKILL.md`: the platform's skill, which comes from no landing. */
export const platformSkill = (
  input: PlatformInput
): Effect.Effect<readonly GeneratedFile[]> =>
  skillFile(input).pipe(Effect.map((content) => [{ content, path: SKILL }]));

// --- The Claude Code plugin ------------------------------------------------------

const hookCommand = (event: HookEvent) => ({
  hooks: [{ command: `${Brand.cli} hook ${event} --json`, type: "command" }],
});

/**
 * `hooks/hooks.json`: before an edit, the scope guard; at the session's
 * start, the claimed ask's brief; at Stop, the verdict gate. Each runs
 * `<cli> hook <event> --json`, which fails open: hooks are early feedback,
 * and the gateway decides.
 */
const hooksJson = () =>
  printJson({
    hooks: Object.fromEntries(
      HookEvent.literals.map((event) => [
        claudeEventOf[event],
        [
          event === "pre-tool-use"
            ? { ...hookCommand(event), matcher: guardedTools.join("|") }
            : hookCommand(event),
        ],
      ])
    ),
  });

const pluginDescription = `The ${Brand.name} CLI's skill, MCP server and hooks: the gate's scope guard before an edit, the claimed ask's brief at the start, and its verdict before you stop.`;

const homepage = (platformUrl: string | undefined) =>
  platformUrl === undefined ? {} : { homepage: platformUrl };

/**
 * `plugins/<slug>/`: `.claude-plugin/plugin.json`, the platform's skill,
 * `.mcp.json` (the platform's `/mcp` over HTTP, or `<cli> mcp` without a
 * URL) and `hooks/hooks.json`.
 */
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
          mcpServers: {
            [Brand.slug]:
              input.platformUrl === undefined
                ? { args: ["mcp"], command: Brand.cli }
                : { type: "http", url: `${input.platformUrl}/mcp` },
          },
        }),
        path: `${PLUGIN}/.mcp.json`,
      },
      { content: hooksJson(), path: `${PLUGIN}/hooks/hooks.json` },
    ])
  );

// --- The Agent Plugins bundle ----------------------------------------------------

const SCHEMAS = "https://agent-plugins.org/schemas/1.0.0";

/**
 * `plugins/<slug>/plugin.json`, the same skill and `mcp.json`: the Agent
 * Plugins 1.0 package, whose manifests are closed (only `$schema` and the
 * listed fields) and carry no hooks, which that standard leaves to each
 * client.
 */
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
          mcpServers: {
            [Brand.slug]:
              input.platformUrl === undefined
                ? { args: ["mcp"], command: Brand.cli, type: "stdio" }
                : { type: "streamable-http", url: `${input.platformUrl}/mcp` },
          },
        }),
        path: `${PLUGIN}/mcp.json`,
      },
    ])
  );
