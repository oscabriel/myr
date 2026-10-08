import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { backend } from "#backend";

import { forwarded } from "../../../features/agents/forward.ts";

// The projects' contribute skills and their index: the platform serves
// them from each project's landed tree; the web host passes GET and HEAD on.
export const Route = createFileRoute("/.well-known/agent-skills/$")({
  server: { handlers: forwarded(backend, env) },
});
