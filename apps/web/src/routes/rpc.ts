import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { backend } from "#backend";

import { rpcHandler } from "../server/rpc.ts";

export const Route = createFileRoute("/rpc")({
  server: {
    handlers: {
      POST: rpcHandler(backend, env),
    },
  },
});
