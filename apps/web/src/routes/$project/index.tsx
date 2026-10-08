import { useAtomMount, useAtomValue } from "@effect/atom-react";
import { Client } from "@repo/protocol/contracts";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { ProjectName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { projectsAtom } from "../../client/front.ts";
import { asksAtom, recentLandingsAtom } from "../../client/project.ts";
import { watchAtom } from "../../client/watch.ts";
import { Reading, Unreachable } from "../../features/front/reading.tsx";
import { ProjectView } from "../../features/project/project-page.tsx";
import { UnknownProjectView } from "../../features/project/unknown-project.tsx";
import { pageTitle } from "../../features/shared/layout.tsx";
import { serverClient } from "../../server/client.ts";

// A project's page. The loader asks the platform, on the server, whether the
// project exists, so an address naming none is a 404 that shows the
// platform's `UnknownProject` refusal; the page's own reads (asks, landings,
// the listing) are atoms the browser calls.

const decodeProject = Schema.decodeEffect(ProjectName);

const decodeName = Schema.decodeUnknownOption(ProjectName);

const isUnknownProject = Schema.is(UnknownProject);

/**
 * Whether the platform knows the project `name`, asked over `#backend` in
 * process. A name that is none, and `UnknownProject`, say no; when the
 * platform cannot be reached, the page renders and says so itself.
 */
const projectKnown = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(({ data }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const name = decodeName(data);

        if (Option.isNone(name)) {
          return false;
        }

        const project = name.value;
        const client = yield* Client;

        return yield* client.listAsks({ project }).pipe(
          Effect.as(true),
          Effect.catchTag("UnknownProject", () => Effect.succeed(false))
        );
      }).pipe(
        Effect.provide(serverClient(env)),
        Effect.orElseSucceed(() => true)
      )
    )
  );

const root = getRouteApi("__root__");

/**
 * The project as listed; a project the list has not heard from yet (its
 * projection catches up after its first event) reads as the platform lists
 * every project until a `PostureChanged` entry projects a posture: open.
 */
const listingOf = (
  project: ProjectName,
  projects: readonly ProjectListing[],
  openAsks: number
): ProjectListing =>
  projects.find((listed) => listed.project === project) ?? {
    openAsks,
    posture: "open",
    project,
  };

const ProjectBody = ({ project }: { readonly project: ProjectName }) => {
  const { platformUrl } = root.useLoaderData();

  // Live: each event the project commits makes these reads fetch again.
  useAtomMount(watchAtom(project));

  const read = AsyncResult.all({
    asks: useAtomValue(asksAtom(project)),
    landings: useAtomValue(recentLandingsAtom(project)),
    listed: useAtomValue(projectsAtom),
  });

  return AsyncResult.matchWithError(read, {
    onDefect: () => <Unreachable title={project} />,
    onError: (error) =>
      isUnknownProject(error) ? (
        <UnknownProjectView name={project} />
      ) : (
        <Unreachable title={project} />
      ),
    onInitial: () => <Reading title={project} />,
    onSuccess: ({ value: { asks, landings, listed } }) => (
      <ProjectView
        asks={asks.asks}
        landings={landings}
        listing={listingOf(project, listed.projects, asks.asks.length)}
        now={DateTime.nowUnsafe()}
        platformUrl={platformUrl}
      />
    ),
  });
};

/** The page, for a name the loader found; a name that is none reads as unknown. */
const ProjectPage = () => {
  const { project } = Route.useParams();

  return Option.match(decodeName(project), {
    onNone: () => <UnknownProjectView name={project} />,
    onSome: (name) => <ProjectBody project={name} />,
  });
};

const Unknown = () => {
  const { project } = Route.useParams();

  return <UnknownProjectView name={project} />;
};

export const Route = createFileRoute("/$project/")({
  component: ProjectPage,
  head: ({ params }) => ({ meta: [{ title: pageTitle(params.project) }] }),
  loader: ({ params }) =>
    Effect.runPromise(
      decodeProject(params.project).pipe(
        Effect.mapError(() => notFound()),
        Effect.flatMap((project) =>
          Effect.promise(() => projectKnown({ data: project }))
        ),
        Effect.filterOrFail(
          (known): known is true => known,
          () => notFound()
        ),
        Effect.asVoid
      )
    ),
  notFoundComponent: Unknown,
});
