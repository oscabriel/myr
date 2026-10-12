/**
 * `/llms-full.txt` imports its text from `@repo/agent-kit/full-llms` itself, so
 * no page that loads this module carries the sections the docs share.
 */
export {
  frontLlms,
  indexBanner,
  mcpCard,
  missingProjectLlms,
  projectLlms,
} from "@repo/agent-kit/host-doc";

export type { McpCard } from "@repo/agent-kit/host-doc";
