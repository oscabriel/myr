import {
  createFileRoute,
  getRouteApi,
  useRouter,
} from "@tanstack/react-router";

import { commands } from "../features/agents/catalog.ts";
import { AgentsView } from "../features/agents/setup-page.tsx";
import { pageHead } from "../features/shared/head.ts";
import { branchPage } from "../server/cache-headers.ts";

// `/agents`: the reference an agent and the person running it read, drawn
// from `@repo/agent-kit` for this stage's platform and the web's own origin
// (the router's: the request's on the server, the page's in the browser),
// so the server's render and the browser's agree. `/agents.md` is the same
// text as Markdown.

const root = getRouteApi("__root__");

const AgentsPage = () => {
  const { platformUrl } = root.useLoaderData();
  const { origin } = useRouter();

  return (
    <AgentsView commands={commands} platformUrl={platformUrl} webUrl={origin} />
  );
};

export const Route = createFileRoute("/agents")({
  component: AgentsPage,
  // The same for every reader, and it changes only with a deploy.
  headers: () => branchPage,
  head: () =>
    pageHead({
      description:
        "How an agent reaches the platform: the CLI's commands, the ways to connect, the endpoints, the limits and the refusals.",
      title: "For agents",
    }),
});
