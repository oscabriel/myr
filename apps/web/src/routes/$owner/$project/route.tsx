import { createFileRoute, Outlet } from "@tanstack/react-router";

import { projectParams } from "../../../server/addresses.ts";

// Every page of a project sits under this route. It reads nothing, so no
// page waits on it: the shell finds the project here (`useCurrentProject`,
// which reads this route's match) and draws the project's part of the rail
// from the name in the address at once, its posture arriving later with the
// list of projects without moving anything. A name no project could take
// is left to the page, which says so. The rail itself is the root's, so
// what a project's pages put in its slot (`staticData.rail`) stays mounted
// as the reader moves between them. Its params give every page below the
// project's full name as `project` (`oscabriel/datekit`).
export const Route = createFileRoute("/$owner/$project")({
  component: Outlet,
  params: projectParams,
});
