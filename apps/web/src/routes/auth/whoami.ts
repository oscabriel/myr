import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { serverClient } from "../../server/client.ts";
import { whoamiHandler } from "../../server/session.ts";

export const Route = createFileRoute("/auth/whoami")({
  server: {
    handlers: {
      GET: whoamiHandler(env, (request) => serverClient(env, request)),
    },
  },
});
