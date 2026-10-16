import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { serverClient } from "../server/client.ts";
import { keptPage } from "../server/kept-pages.ts";
import { frontLlmsHandler } from "../server/llms.ts";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: keptPage(
        frontLlmsHandler(
          (request) => serverClient(env, request),
          env.PUBLIC_PLATFORM_URL
        )
      ),
    },
  },
});
