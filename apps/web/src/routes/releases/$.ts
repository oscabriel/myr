import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { backend } from "#backend";

import { forwarded } from "../../features/agents/forward.ts";

export const Route = createFileRoute("/releases/$")({
  server: { handlers: forwarded(backend, env) },
});
