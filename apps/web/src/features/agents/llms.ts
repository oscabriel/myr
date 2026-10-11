/**
 * What an agent, or a person, reads first on the web host: `/llms.txt`,
 * `/<owner>/<name>/llms.txt` and the MCP card at `/.well-known/mcp.json`, and the
 * banner under the title of the web's other Markdown. The text lives in
 * `@repo/agent-kit`'s `host-doc`, which the platform's own `/` serves too,
 * so both hosts say the same thing; the routes import it from here.
 * `/llms-full.txt` imports its text from `@repo/agent-kit/full-llms` itself,
 * so no page that loads this module carries the sections the docs share.
 */
export {
  frontLlms,
  indexBanner,
  mcpCard,
  missingProjectLlms,
  projectLlms,
} from "@repo/agent-kit/host-doc";

export type { McpCard } from "@repo/agent-kit/host-doc";
