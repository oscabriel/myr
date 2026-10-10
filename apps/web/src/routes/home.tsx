import { createFileRoute } from "@tanstack/react-router";

import { pageHead } from "../features/shared/head.ts";
import { Workspace } from "../features/shared/shell/workspace.tsx";
import { personalPage } from "../server/cache-headers.ts";

// `/home`: a signed-in reader's own page, where the landing sends them. A
// page about its reader is kept by no cache.

const HomePage = () => <Workspace title="Home">{null}</Workspace>;

export const Route = createFileRoute("/home")({
  component: HomePage,
  headers: () => personalPage,
  head: () => pageHead({ title: "Home" }),
});
