import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { serverClient } from "../../../server/client.ts";
import { projectLlmsHandler } from "../../../server/llms.ts";

// `/<project>/llms.txt`: one project for an agent (`server/llms.ts`).
export const Route = createFileRoute("/$owner/$project/llms.txt")({
  server: {
    handlers: {
      GET: projectLlmsHandler(
        (request) => serverClient(env, request),
        env.PUBLIC_PLATFORM_URL
      ),
    },
  },
});
