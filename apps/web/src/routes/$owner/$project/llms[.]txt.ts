import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { serverClient } from "../../../server/client.ts";
import { keptPage } from "../../../server/kept-pages.ts";
import { projectLlmsHandler } from "../../../server/llms.ts";

export const Route = createFileRoute("/$owner/$project/llms.txt")({
  server: {
    handlers: {
      GET: keptPage(
        projectLlmsHandler(
          (request) => serverClient(env, request),
          env.PUBLIC_PLATFORM_URL
        )
      ),
    },
  },
});
