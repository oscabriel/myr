import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { withProjectName } from "../../../server/addresses.ts";
import { serverClient } from "../../../server/client.ts";
import { projectLlmsHandler } from "../../../server/llms.ts";

// `/<project>/llms.txt`: one project for an agent (`server/llms.ts`).
export const Route = createFileRoute("/$owner/$project/llms.txt")({
  server: {
    handlers: {
      GET: withProjectName(
        projectLlmsHandler(
          (request) => serverClient(env, request),
          env.PUBLIC_PLATFORM_URL
        )
      ),
    },
  },
});
