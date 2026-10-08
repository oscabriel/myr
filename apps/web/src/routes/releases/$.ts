import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { backend } from "#backend";

import { forwarded } from "../../features/agents/forward.ts";

// The CLI's releases (the manifest, each version's binaries and checksums,
// and `latest`'s redirects, which are path-absolute and so stay on this
// host): the platform serves them; the web passes GET and HEAD on.
export const Route = createFileRoute("/releases/$")({
  server: { handlers: forwarded(backend, env) },
});
