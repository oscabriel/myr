import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { signInHandler } from "../../server/session.ts";

export const Route = createFileRoute("/auth/signin")({
  server: {
    handlers: {
      GET: signInHandler(env),
    },
  },
});
