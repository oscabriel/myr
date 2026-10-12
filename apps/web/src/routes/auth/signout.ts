import { createFileRoute } from "@tanstack/react-router";

import { signOutHandler } from "../../server/session.ts";

export const Route = createFileRoute("/auth/signout")({
  server: {
    handlers: {
      GET: signOutHandler,
      POST: signOutHandler,
    },
  },
});
