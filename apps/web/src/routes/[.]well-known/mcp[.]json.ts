import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { mcpCard } from "../../features/agents/llms.ts";
import { cardResponse } from "../../features/agents/respond.ts";

// The platform's MCP endpoint, described for a client that starts from the
// web host: where it is, how it speaks, and where to learn to sign in.
export const Route = createFileRoute("/.well-known/mcp.json")({
  server: {
    handlers: {
      GET: () =>
        cardResponse(mcpCard({ platformUrl: env.PUBLIC_PLATFORM_URL })),
    },
  },
});
