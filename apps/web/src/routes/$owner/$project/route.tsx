import { createFileRoute, Outlet } from "@tanstack/react-router";

import { projectParams } from "../../../server/addresses.ts";

// Reads nothing, so no page waits on it. The rail is the root's, so what a project's pages put in its slot
// (`staticData.rail`) stays mounted as the reader moves between them.
export const Route = createFileRoute("/$owner/$project")({
  component: Outlet,
  params: projectParams,
});
