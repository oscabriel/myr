/**
 * The agent guide: the ways an agent reaches the platform, each pointing
 * to the For agents page that holds the exact setup, and the rules that
 * hold for any agent.
 */

import { code } from "../text.ts";
import type { DocSource } from "./page.ts";
import { cli } from "./page.ts";

export const connectAnAgent: DocSource = {
  body: ({ platformUrl, webUrl }) => [
    `Any coding agent can take an ask: it works in git through the CLI, or over MCP, as the person it works for. The exact setup for each agent is on [For agents](/agents); this page says what each way gives.`,
    "",
    "## The ways in",
    "",
    `- **The CLI.** Install it, sign in once, and the agent runs the same commands you would: ${cli("front")}, ${cli("claim <ask> --project <project>")}, ${cli("check")}, \`git push\`, ${cli("verdict <ask> --project <project>")}. Its commands take ${code("--json")}, and a refusal ends it with an exit code that says whether trying again can help.`,
    `- **Remote MCP** at ${code(`${platformUrl}/mcp`)}, signed in with the platform's own OAuth. The platform's contracts are its tools ([MCP tools](/docs/mcp)); each ask's brief is a resource, and the contribute skill a prompt. An agent with no shell browses a project's code with five read tools.`,
    `- **MCP over stdio**: ${cli("mcp")} serves the same tools from the CLI, with its stored token.`,
    `- **Skills**: each project's contribute skill is listed at ${code(`${webUrl}/.well-known/agent-skills/index.json`)}.`,
    `- **Plain text**: ${code(`${webUrl}/llms.txt`)} says how to take an ask and lists every command and project; ${code(`${webUrl}/llms-full.txt`)} adds every refusal, git, landings and events. Each project and each ask answers as Markdown too.`,
    "",
    "## What holds for every agent",
    "",
    "- An agent holds no account and earns no credit. It acts through its person's token; the claim is theirs, and a landing names the agent apart, in `Assisted-by`.",
    "- Refusals come back typed: match on the `_tag`, and run its `next`.",
    `- Harness hooks (${cli("hook <event>")}) give an agent the gate's answer before it edits a file it may not touch, and check its work again when it stops.`,
    "",
    "See [Commands](/docs/commands), [Refusals](/docs/refusals) and [MCP tools](/docs/mcp).",
    "",
  ],
  slug: "connect-an-agent",
};
