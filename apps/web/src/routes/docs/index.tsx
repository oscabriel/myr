import { docPages } from "@repo/agent-kit/docs/index";
import {
  createFileRoute,
  getRouteApi,
  useRouter,
} from "@tanstack/react-router";

import { commands } from "../../features/agents/catalog.ts";
import { DocsIndexView } from "../../features/docs/docs-view.tsx";
import { docsIndexHead } from "../../features/docs/head.ts";
import { branchPage } from "../../server/cache-headers.ts";

// `/docs`: the guides and the reference, each page with its summary,
// written for this stage's platform and the web's own origin. The same for
// every reader, and it changes only with a deploy.

const root = getRouteApi("__root__");

const DocsIndex = () => {
  const { platformUrl } = root.useLoaderData();
  const { origin } = useRouter();

  return (
    <DocsIndexView
      pages={docPages({ commands, platformUrl, webUrl: origin })}
    />
  );
};

export const Route = createFileRoute("/docs/")({
  component: DocsIndex,
  headers: () => branchPage,
  head: docsIndexHead,
});
