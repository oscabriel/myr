/**
 * What an agent, or a person, reads first on the web host: `/llms.txt`,
 * `/<project>/llms.txt` and the MCP card at `/.well-known/mcp.json`. The
 * text lives in `@repo/agent-kit/host-doc`, which the platform's own `/`
 * serves too, so both hosts say the same thing; the routes import it from
 * here.
 */
export {
  frontLlms,
  mcpCard,
  missingProjectLlms,
  projectLlms,
} from "@repo/agent-kit/host-doc";

export type { McpCard } from "@repo/agent-kit/host-doc";
