import { docPage } from "@repo/agent-kit/docs/index";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { Option } from "effect";

import { commands } from "../../features/agents/catalog.ts";
import { markdown } from "../../features/agents/respond.ts";

// `/docs/<page>.md`: a page of the docs as Markdown (a literal `.` is `[.]`
// in a route file's name; `{$page}` keeps the param apart from it), the
// same text the page draws, for the web's own origin.

/** The route's handler as a function of the platform's URL, which its test hands in. */
export const docsMarkdownHandler =
  (platformUrl: string) =>
  ({
    params,
    request,
  }: {
    readonly params: { readonly page: string };
    readonly request: Request;
  }): Promise<Response> =>
    Promise.resolve(
      Option.match(
        docPage(
          { commands, platformUrl, webUrl: new URL(request.url).origin },
          params.page
        ),
        {
          onNone: () =>
            markdown(
              `# No such page\n\nThe docs have no page \`${params.page}\`. Every page is listed at /docs.\n`,
              404
            ),
          onSome: (page) => markdown(page.markdown),
        }
      )
    );

export const Route = createFileRoute("/docs/{$page}.md")({
  server: {
    handlers: {
      GET: docsMarkdownHandler(env.PUBLIC_PLATFORM_URL),
    },
  },
});
