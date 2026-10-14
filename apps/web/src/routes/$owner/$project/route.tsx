import {
  createFileRoute,
  getRouteApi,
  Outlet,
  useLocation,
  useMatch,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Option, Schema } from "effect";
import { useMemo, useState } from "react";

import { ProjectFrame } from "../../../features/project/project-frame.tsx";
import { ProjectHeader } from "../../../features/project/project-header.tsx";
import {
  inProjectFrame,
  projectTabOf,
} from "../../../features/shared/shell/sections.ts";
import { useShellName } from "../../../features/shared/shell/shells.ts";
import { projectParams } from "../../../server/addresses.ts";
import { serverClient } from "../../../server/client.ts";
import {
  ProjectHeaderData,
  readProjectHeader,
} from "../../../server/project-page.ts";
import { ProjectCodeBar } from "./-code-bar.tsx";

/** The header for a project's page, or none when it cannot be read: the page under it says why. */
export const headerOrNone = (name: string) =>
  readProjectHeader(name).pipe(
    Effect.map(Option.some),
    Effect.orElseSucceed(() => Option.none()),
    Effect.map(Option.getOrUndefined)
  );

// Read beside each page's own loader, never before it: TanStack runs a layout's loader and its child's at once.
const projectHeader = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(({ data }) =>
    Effect.runPromise(
      headerOrNone(data).pipe(Effect.provide(serverClient(env)))
    )
  );

const root = getRouteApi("__root__");

const decodeHeader = Schema.decodeSync(ProjectHeaderData);

/**
 * The layout reads the header for every page drawn under it, but Overview,
 * which reads its header with its own reads, and a focused page (a new
 * proposal), which draws none.
 */
export const headerLoader =
  (
    read: (
      project: string
    ) => Promise<typeof ProjectHeaderData.Encoded | undefined>
  ) =>
  ({
    location,
    params,
  }: {
    readonly location: { readonly pathname: string };
    readonly params: { readonly project: string };
  }) =>
    inProjectFrame(location.pathname) &&
    projectTabOf(location.pathname) !== "overview"
      ? read(params.project)
      : undefined;

/**
 * Overview's header when Overview is open, else the layout's own. The last
 * one drawn stays while the reader moves on from Overview: the layout's loader
 * runs when the reader enters the project, not on each move inside it.
 */
const useHeaderRead = () => {
  const loaded = Route.useLoaderData();

  const fromOverview = useMatch({
    from: "/$owner/$project/",
    select: (match) => match.loaderData?.header,
    shouldThrow: false,
  });

  const latest = fromOverview ?? loaded;
  const [kept, setKept] = useState(latest);

  if (latest !== undefined && latest !== kept) {
    setKept(latest);
  }

  const encoded = latest ?? kept;

  return useMemo(
    () => (encoded === undefined ? undefined : decodeHeader(encoded)),
    [encoded]
  );
};

const ProjectLayout = () => {
  const { platformUrl } = root.useLoaderData();
  const shell = useShellName();
  const header = useHeaderRead();

  // The current tab and the title's element follow the path alone: a fragment never reaches the server.
  const pathname = useLocation({ select: (location) => location.pathname });

  // A focused page under a project (a new proposal) draws no project frame.
  if (shell !== "project") {
    return <Outlet />;
  }

  return (
    <ProjectFrame
      header={
        header === undefined ? undefined : (
          <ProjectHeader
            current={projectTabOf(pathname)}
            header={header}
            platformUrl={platformUrl}
          />
        )
      }
      codeBar={<ProjectCodeBar platformUrl={platformUrl} />}
    >
      <Outlet />
    </ProjectFrame>
  );
};

/**
 * How long the header's facts stand before a move between the project's pages
 * reads them again: without it the router reads the six facts on every move.
 * A reader who enters at a page with no header of its own (a new proposal)
 * and moves to a tab within this time sees the frame without a header until
 * the next read.
 */
export const HEADER_STALE_MS = 60_000;

// One header for every page of a project, and the page's side column (`staticData.column`) under it, so both
// stay mounted as the reader moves between the project's pages.
export const Route = createFileRoute("/$owner/$project")({
  staticData: { shell: "project" },
  params: projectParams,
  loader: headerLoader((project) => projectHeader({ data: project })),
  staleTime: HEADER_STALE_MS,
  component: ProjectLayout,
});
