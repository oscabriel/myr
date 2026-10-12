import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { serverClient } from "../../server/client.ts";
import { callbackHandler } from "../../server/session.ts";

export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: callbackHandler(env, (request) => serverClient(env, request)),
    },
  },
});
