import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { callbackHandler } from "../../server/session.ts";

// The platform sends the browser back here with a code, which becomes the
// session cookie (issue 513; src/server/session.ts).
export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: callbackHandler(env),
    },
  },
});
