import {
  createFileRoute,
  getRouteApi,
  useRouter,
} from "@tanstack/react-router";

import { commands } from "../features/agents/catalog.ts";
import { AgentsView } from "../features/agents/setup-page.tsx";
import { pageHead } from "../features/shared/head.ts";
import { branchPage } from "../server/cache-headers.ts";

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
  headers: () => branchPage,
  head: () =>
    pageHead({
      description:
        "How an agent reaches the platform: the CLI's commands, the ways to connect, the endpoints, the limits and the refusals.",
      title: "For agents",
    }),
});
