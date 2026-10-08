import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { backend } from "#backend";

import { forwarded } from "../features/agents/forward.ts";

// The CLI's install script, so `curl -fsSL <web>/install.sh | sh` works
// from the web host: the platform serves it (W4 420); the web passes GET
// and HEAD on.
export const Route = createFileRoute("/install.sh")({
  server: { handlers: forwarded(backend, env) },
});
