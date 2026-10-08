import { createFileRoute } from "@tanstack/react-router";

import { signOutHandler } from "../../server/session.ts";

// Sign-out ends the session cookie: the header's form posts here, and a
// plain link works too (issue 513).
export const Route = createFileRoute("/auth/signout")({
  server: {
    handlers: {
      GET: signOutHandler,
      POST: signOutHandler,
    },
  },
});
