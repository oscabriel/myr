import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { backend } from "#backend";

import { forwarded } from "../../../features/agents/forward.ts";

export const Route = createFileRoute("/.well-known/agent-skills/$")({
  server: { handlers: forwarded(backend, env) },
});
