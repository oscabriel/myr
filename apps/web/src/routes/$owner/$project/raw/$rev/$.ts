import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { backend } from "#backend";

import { forwarded } from "../../../../features/agents/forward.ts";

// A file's bytes at a revision: the platform serves them, under its
// sandboxing headers and content types, at the same path; the web
// passes GET and HEAD on and hands the answer back untouched, headers and
// all, as `routes/releases/$.ts` does.
export const Route = createFileRoute("/$project/raw/$rev/$")({
  server: { handlers: forwarded(backend, env) },
});
