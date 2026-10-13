import { createFileRoute, Outlet } from "@tanstack/react-router";

import { projectParams } from "../../../server/addresses.ts";

// Reads nothing, so no page waits on it. The side column is the shell's, so what a project's pages put in it
// (`staticData.column`) stays mounted as the reader moves between them.
export const Route = createFileRoute("/$owner/$project")({
  staticData: { shell: "project" },
  component: Outlet,
  params: projectParams,
});
