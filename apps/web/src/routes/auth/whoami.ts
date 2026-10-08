import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { serverClient } from "../../server/client.ts";
import { whoamiHandler } from "../../server/session.ts";

// Who is signed in, as the platform's `status` names the session's caller,
// asked in process through `#backend` (issue 513).
export const Route = createFileRoute("/auth/whoami")({
  server: {
    handlers: {
      GET: whoamiHandler((request) => serverClient(env, request)),
    },
  },
});
