import { createFileRoute } from "@tanstack/react-router";

import { clientMetadataHandler } from "../../server/session.ts";

export const Route = createFileRoute("/auth/client")({
  server: {
    handlers: {
      GET: clientMetadataHandler,
    },
  },
});
