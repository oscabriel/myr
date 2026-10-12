import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { backend } from "#backend";

import { forwarded } from "../../../../../features/agents/forward.ts";

// The platform serves the bytes under its sandboxing headers; the web passes GET and HEAD on and hands the answer back untouched.
export const Route = createFileRoute("/$owner/$project/raw/$rev/$")({
  server: { handlers: forwarded(backend, env) },
});
