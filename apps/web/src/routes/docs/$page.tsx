import { createFileRoute } from "@tanstack/react-router";

import { pageHead } from "../../features/shared/head.ts";
import { Workspace } from "../../features/shared/shell/workspace.tsx";
import { branchPage } from "../../server/cache-headers.ts";

// `/docs/<page>`: one guide or reference page. The same for every reader,
// and it changes only with a deploy.

const DocsPage = () => {
  const { page } = Route.useParams();

  return <Workspace title={page}>{null}</Workspace>;
};

export const Route = createFileRoute("/docs/$page")({
  component: DocsPage,
  headers: () => branchPage,
  head: ({ params }) => pageHead({ title: params.page }),
});
