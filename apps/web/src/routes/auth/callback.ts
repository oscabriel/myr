import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { serverClient } from "../../server/client.ts";
import { callbackHandler } from "../../server/session.ts";

// The platform sends the browser back here with a code, which becomes the
// session cookie, beside the handle the platform's `status` names for it
// (src/server/session.ts).
export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: callbackHandler(env, (request) => serverClient(env, request)),
    },
  },
});
