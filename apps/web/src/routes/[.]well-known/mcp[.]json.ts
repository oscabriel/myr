import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { mcpCard } from "../../features/agents/llms.ts";
import { cardResponse } from "../../features/agents/respond.ts";

export const Route = createFileRoute("/.well-known/mcp.json")({
  server: {
    handlers: {
      GET: () =>
        cardResponse(mcpCard({ platformUrl: env.PUBLIC_PLATFORM_URL })),
    },
  },
});
