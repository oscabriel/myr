import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { signInHandler } from "../../server/session.ts";

// Sign-in starts here: to the platform's /authorize with PKCE (issue 513;
// src/server/session.ts).
export const Route = createFileRoute("/auth/signin")({
  server: {
    handlers: {
      GET: signInHandler(env),
    },
  },
});
