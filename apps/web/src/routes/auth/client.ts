import { createFileRoute } from "@tanstack/react-router";

import { clientMetadataHandler } from "../../server/session.ts";

// The web's OAuth client, as a Client ID Metadata Document: its URL is the
// client id the platform's /authorize reads.
export const Route = createFileRoute("/auth/client")({
  server: {
    handlers: {
      GET: clientMetadataHandler,
    },
  },
});
