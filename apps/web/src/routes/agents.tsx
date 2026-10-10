import { agentSetup } from "@repo/agent-kit/agent-setup";
import {
  createFileRoute,
  getRouteApi,
  useRouter,
} from "@tanstack/react-router";

import { commands } from "../features/agents/catalog.ts";
import { AgentSetupView } from "../features/agents/setup-page.tsx";
import { pageTitle } from "../features/shared/head.ts";
import { PageShell } from "../features/shared/layout.tsx";

// `/agents`: how each agent connects, drawn from `@repo/agent-kit`'s
// `agentSetup` for this stage's platform and the web's own origin (the
// router's: the request's on the server, the page's in the browser), so
// the server's render and the browser's agree. `/agents.md` is the same
// text as Markdown.

const root = getRouteApi("__root__");

const AgentsPage = () => {
  const { platformUrl } = root.useLoaderData();
  const { origin } = useRouter();

  return (
    <PageShell title="Agents">
      <AgentSetupView
        channels={agentSetup({ commands, platformUrl, webUrl: origin })}
      />
    </PageShell>
  );
};

export const Route = createFileRoute("/agents")({
  component: AgentsPage,
  head: () => ({ meta: [{ title: pageTitle("Agents") }] }),
});
