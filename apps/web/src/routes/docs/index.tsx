import { createFileRoute } from "@tanstack/react-router";

import { pageHead } from "../../features/shared/head.ts";
import { Workspace } from "../../features/shared/shell/workspace.tsx";
import { branchPage } from "../../server/cache-headers.ts";

// `/docs`: the guides and the reference, each page with its summary. The
// same for every reader, and it changes only with a deploy.

const DocsIndex = () => <Workspace title="Docs">{null}</Workspace>;

export const Route = createFileRoute("/docs/")({
  component: DocsIndex,
  headers: () => branchPage,
  head: () => pageHead({ title: "Docs" }),
});
