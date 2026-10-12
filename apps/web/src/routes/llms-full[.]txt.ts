import { fullLlms } from "@repo/agent-kit/full-llms";
import { Client } from "@repo/protocol/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import type { Layer } from "effect";

import { commands } from "../features/agents/catalog.ts";
import { markdown, unavailable } from "../features/agents/respond.ts";
import { serverClient } from "../server/client.ts";

export const llmsFullHandler =
  (clientFor: (request: Request) => Layer.Layer<Client>, platformUrl: string) =>
  ({ request }: { readonly request: Request }): Promise<Response> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* Client;
        const { projects } = yield* client.listProjects({});

        return markdown(
          fullLlms({
            commands,
            platformUrl,
            projects,
            webUrl: new URL(request.url).origin,
          })
        );
      }).pipe(
        Effect.provide(clientFor(request)),
        // Unanswered or unreachable alike: try again soon, and keep nothing.
        Effect.catchCause(() => Effect.succeed(unavailable()))
      )
    );

export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: llmsFullHandler(
        (request) => serverClient(env, request),
        env.PUBLIC_PLATFORM_URL
      ),
    },
  },
});
