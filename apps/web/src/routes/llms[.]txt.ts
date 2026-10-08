import { Client } from "@repo/protocol/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { Effect } from "effect";

import { commands } from "../features/agents/catalog.ts";
import { frontLlms } from "../features/agents/llms.ts";
import { markdown, unavailable } from "../features/agents/respond.ts";
import { serverClient } from "../server/client.ts";

/**
 * `/llms.txt`: the platform for an agent, with the projects it lists now,
 * read through the same backend the browser's calls take.
 */
const llms = (request: Request) =>
  Effect.gen(function* () {
    const client = yield* Client;
    const { projects } = yield* client.listProjects({});

    return markdown(
      frontLlms({
        commands,
        platformUrl: env.PUBLIC_PLATFORM_URL,
        projects,
        webUrl: new URL(request.url).origin,
      })
    );
  }).pipe(
    Effect.orElseSucceed(unavailable),
    Effect.provide(serverClient(env, request))
  );

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: ({ request }) => Effect.runPromise(llms(request)),
    },
  },
});
