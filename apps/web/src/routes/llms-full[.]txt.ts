import { Client } from "@repo/protocol/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import type { Layer } from "effect";

import { commands } from "../features/agents/catalog.ts";
import { fullLlms } from "../features/agents/llms.ts";
import { markdown, unavailable } from "../features/agents/respond.ts";
import { serverClient } from "../server/client.ts";

/**
 * `/llms-full.txt`: the index, then every refusal, how git meets the
 * platform, how a landing happens, the events and the guides, with the
 * projects the platform lists now. The web alone serves it: the platform's
 * `/` stays the index (`apps/platform/test/home.test.ts`).
 */

/** The route's handler as a function of its client and the platform's URL, which its test hands in. */
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
