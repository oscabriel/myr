import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { backend } from "#backend";

import { forwarded } from "../../../features/agents/forward.ts";
import { keptPage } from "../../../server/kept-pages.ts";

const { GET, HEAD } = forwarded(backend, env);

export const Route = createFileRoute("/.well-known/agent-skills/$")({
  server: { handlers: { GET: keptPage(GET), HEAD } },
});
