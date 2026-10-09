import { useAtomMount, useAtomValue } from "@effect/atom-react";
import { FileView, TreeListing } from "@repo/protocol/domain/code";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { ProjectName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { projectCodeAtom } from "../../client/code.ts";
import { projectsAtom } from "../../client/front.ts";
import { asksAtom, recentLandingsAtom } from "../../client/project.ts";
import { watchAtom } from "../../client/watch.ts";
import { Unreachable } from "../../features/front/reading.tsx";
import {
  ProjectReadingView,
  ProjectView,
} from "../../features/project/project-page.tsx";
import { UnknownProjectView } from "../../features/project/unknown-project.tsx";
import { pageTitle } from "../../features/shared/layout.tsx";
import { serverClient } from "../../server/client.ts";
import { readFolderWithReadme } from "../../server/folder.ts";

// A project's page. The loader asks the platform, on the server, for the
// project's root folder at main and its README, so the page arrives with
// its code and a crawler reads the README; the same read says whether the
// project exists, so an address naming none is a 404 that shows the
// platform's `UnknownProject` refusal. The page's other reads (asks,
// landings, the listing) are atoms the browser calls, and the code's atom
// keeps it live once it has a value.

const decodeName = Schema.decodeUnknownOption(ProjectName);

const isUnknownProject = Schema.is(UnknownProject);

/** What the loader hands the page: the project's code, when it could be read. */
export const ProjectPageData = Schema.Struct({
  code: Schema.optionalKey(
    Schema.Struct({
      readme: Schema.optionalKey(FileView),
      root: TreeListing,
    })
  ),
});

const encodePage = Schema.encodeEffect(ProjectPageData);

/**
 * The project's page data, read over `Client`, or a not-found for a name
 * that is none or a project the platform does not know. A project whose
 * main has not landed, or whose code the platform cannot read now, has a
 * page without its code; when the platform did not answer, the page's own
 * reads say so.
 */
export const readProjectPage = (name: string) =>
  Effect.gen(function* () {
    const project = yield* Effect.fromOption(decodeName(name));

    const code = yield* readFolderWithReadme({
      path: Option.none(),
      project,
      rev: "main",
    }).pipe(
      Effect.map(({ listing, readme }) =>
        Option.some({
          root: listing,
          ...Option.match(readme, {
            onNone: () => ({}),
            onSome: (file) => ({ readme: file }),
          }),
        })
      ),
      Effect.catchTag("UnknownProject", () => Effect.fail(notFound())),
      Effect.catchTag(
        ["RpcClientError", "Unauthenticated", "UnknownPath", "UnknownRevision"],
        () => Effect.succeedNone
      )
    );

    // What the platform sent decoded, so it encodes; a failure is a defect.
    return yield* encodePage(
      Option.match(code, {
        onNone: () => ({}),
        onSome: (read) => ({ code: read }),
      })
    ).pipe(Effect.orDie);
  }).pipe(Effect.catchTag("NoSuchElementError", () => Effect.fail(notFound())));

const projectPage = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(({ data }) =>
    Effect.runPromise(
      readProjectPage(data).pipe(Effect.provide(serverClient(env)))
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

const decodePage = Schema.decodeSync(ProjectPageData);

const ProjectBody = ({ project }: { readonly project: ProjectName }) => {
  const { platformUrl } = root.useLoaderData();
  const read = decodePage(Route.useLoaderData());

  // Live: each event the project commits makes these reads fetch again.
  useAtomMount(watchAtom(project));

  const reads = AsyncResult.all({
    asks: useAtomValue(asksAtom(project)),
    landings: useAtomValue(recentLandingsAtom(project)),
    listed: useAtomValue(projectsAtom),
  });

  // The root folder and README: the loader's, read on the server, until the
  // atom has its own (it reads again on each landing). A project whose main
  // has not landed (or whose code cannot be read now) shows its page
  // without them.
  const code = Option.getOrElse(
    AsyncResult.value(useAtomValue(projectCodeAtom(project))),
    () => read.code
  );

  return AsyncResult.matchWithError(reads, {
    onDefect: () => <Unreachable title={project} />,
    onError: (error) =>
      isUnknownProject(error) ? (
        <UnknownProjectView name={project} />
      ) : (
        <Unreachable title={project} />
      ),
    onInitial: () => (
      <ProjectReadingView
        code={code}
        platformUrl={platformUrl}
        project={project}
      />
    ),
    onSuccess: ({ value: { asks, landings, listed } }) => (
      <ProjectView
        asks={asks.asks}
        code={code}
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
  loader: ({ params }) => projectPage({ data: params.project }),
  notFoundComponent: Unknown,
});
