import {
  createFileRoute,
  getRouteApi,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Option, Schema } from "effect";
import { useMemo } from "react";

import { ProjectFrame } from "../../../features/project/project-frame.tsx";
import { ProjectHeader } from "../../../features/project/project-header.tsx";
import {
  projectSections,
  projectTabOf,
} from "../../../features/shared/shell/sections.ts";
import type { ProjectTab } from "../../../features/shared/shell/sections.ts";
import { useShellName } from "../../../features/shared/shell/shells.ts";
import { projectParams } from "../../../server/addresses.ts";
import { serverClient } from "../../../server/client.ts";
import {
  ProjectHeaderData,
  readProjectHeader,
} from "../../../server/project-page.ts";

// Read beside each page's own loader, never before it: TanStack runs a layout's loader and its child's at once.
// A project it cannot read has no header, and the page under it says why.
const projectHeader = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(({ data }) =>
    Effect.runPromise(
      readProjectHeader(data).pipe(
        Effect.map(Option.some),
        Effect.orElseSucceed(() => Option.none()),
        Effect.map(Option.getOrUndefined),
        Effect.provide(serverClient(env))
      )
    )
  );

const root = getRouteApi("__root__");

const decodeHeader = Schema.decodeSync(ProjectHeaderData);

/** Overview's regions stand for the tabs whose own pages are not built yet. */
const tabAt = (pathname: string, hash: string): ProjectTab | undefined => {
  const tab = projectTabOf(pathname);

  return tab === "overview"
    ? (projectSections("").find((section) => section.hash === hash)?.tab ??
        tab)
    : tab;
};

const ProjectLayout = () => {
  const loaded = Route.useLoaderData();
  const { platformUrl } = root.useLoaderData();
  const shell = useShellName();

  const { hash, pathname } = useLocation({
    select: (location) => ({
      hash: location.hash,
      pathname: location.pathname,
    }),
  });

  const header = useMemo(
    () => (loaded === undefined ? undefined : decodeHeader(loaded)),
    [loaded]
  );

  // A focused page under a project (a new proposal) draws no project frame.
  if (shell !== "project") {
    return <Outlet />;
  }

  return (
    <ProjectFrame
      header={
        header === undefined ? undefined : (
          <ProjectHeader
            current={tabAt(pathname, hash)}
            header={header}
            platformUrl={platformUrl}
          />
        )
      }
    >
      <Outlet />
    </ProjectFrame>
  );
};

// One header for every page of a project, and the page's side column (`staticData.column`) under it, so both
// stay mounted as the reader moves between the project's pages.
export const Route = createFileRoute("/$owner/$project")({
  staticData: { shell: "project" },
  params: projectParams,
  loader: ({ params }) => projectHeader({ data: params.project }),
  component: ProjectLayout,
});
