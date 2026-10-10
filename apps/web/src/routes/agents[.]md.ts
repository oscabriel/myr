import { agentSetupMarkdown } from "@repo/agent-kit/agent-setup";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { commands } from "../features/agents/catalog.ts";
import { markdown } from "../features/agents/respond.ts";

// `/agents.md`: the Agents page as Markdown (a literal `.` is `[.]` in a
// route file's name), from the same `agentSetup` the page draws, for the
// web's own origin.

/** The route's handler as a function of the platform's URL, which its test hands in. */
export const agentsMarkdownHandler =
  (platformUrl: string) =>
  ({ request }: { readonly request: Request }): Promise<Response> =>
    Promise.resolve(
      markdown(
        agentSetupMarkdown({
          commands,
          platformUrl,
          webUrl: new URL(request.url).origin,
        })
      )
    );

export const Route = createFileRoute("/agents.md")({
  server: {
    handlers: {
      GET: agentsMarkdownHandler(env.PUBLIC_PLATFORM_URL),
    },
  },
});
