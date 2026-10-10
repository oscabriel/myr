/**
 * What an agent, or a person, reads first on the web host: `/llms.txt`,
 * `/llms-full.txt`, `/<project>/llms.txt` and the MCP card at
 * `/.well-known/mcp.json`, and the banner that opens the web's other
 * Markdown. The text lives in `@repo/agent-kit` (`host-doc`, which the
 * platform's own `/` serves too, so both hosts say the same thing, and
 * `full-llms`, which only the web serves); the routes import it from here.
 */
export { fullLlms } from "@repo/agent-kit/full-llms";

export {
  frontLlms,
  indexBanner,
  mcpCard,
  missingProjectLlms,
  projectLlms,
} from "@repo/agent-kit/host-doc";

export type { McpCard } from "@repo/agent-kit/host-doc";
