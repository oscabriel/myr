import { useAtomMount, useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Option, Predicate, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";

import { projectEventsAtom } from "../../../../client/events.ts";
import { asksAtom } from "../../../../client/project.ts";
import { SeededAtoms, seedSuccess } from "../../../../client/seeded.ts";
import type { Seed } from "../../../../client/seeded.ts";
import { watchAtom } from "../../../../client/watch.ts";
import { useStamps } from "../../../../features/front/stamps.ts";
import { ProjectAsksView } from "../../../../features/project/asks-page.tsx";
import { UnknownProjectView } from "../../../../features/project/unknown-project.tsx";
import { askStates } from "../../../../features/shared/ask-progress.ts";
import { pageHead } from "../../../../features/shared/head.ts";
import { reloadOnEnter } from "../../../../features/shared/shell/selection.ts";
import { branchPage } from "../../../../server/cache-headers.ts";
import { serverClient } from "../../../../server/client.ts";
import {
  ProjectAsksData,
  readProjectAsks,
} from "../../../../server/project-page.ts";

const asksPage = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(({ data }) =>
    Effect.runPromise(
      readProjectAsks(data).pipe(Effect.provide(serverClient(env)))
    )
  );

const LiveAsks = ({ data }: { readonly data: ProjectAsksData }) => {
  const { project } = data;

  useAtomMount(watchAtom(project));

  const asksRead = useAtomValue(asksAtom(project));

  const asks = Option.getOrElse(
    Option.map(AsyncResult.value(asksRead), ({ asks: listed }) => listed),
    () => data.asks
  );

  const events = Option.getOrElse(
    AsyncResult.value(useAtomValue(projectEventsAtom(project))),
    () => data.events
  );

  const reads = useMemo(
    () => new Map(events === undefined ? [] : [[project, events]]),
    [events, project]
  );

  const stamps = useStamps(reads)(project);
  const states = useMemo(() => askStates(events ?? []), [events]);

  return (
    <ProjectAsksView
      asks={asks}
      now={data.now}
      parents={data.parents}
      project={project}
      stamps={stamps}
      states={states}
      unreachable={AsyncResult.isFailure(asksRead)}
    />
  );
};

const AsksPage = () => {
  const loaded = Route.useLoaderData();

  const data = useMemo(
    () => Schema.decodeSync(ProjectAsksData)(loaded),
    [loaded]
  );

  const { project } = data;

  const seeds: readonly Seed[] = [
    ...(data.asks === undefined
      ? []
      : [seedSuccess(asksAtom(project), { asks: data.asks })]),
    ...(data.events === undefined
      ? []
      : [seedSuccess(projectEventsAtom(project), data.events)]),
  ];

  return (
    <SeededAtoms id={`${project}/asks`} seeds={seeds}>
      <LiveAsks data={data} />
    </SeededAtoms>
  );
};

const Unknown = () => {
  const { project } = Route.useParams();

  return <UnknownProjectView name={project} />;
};

export const Route = createFileRoute("/$owner/$project/asks/")({
  staticData: { shell: "project" },
  // TanStack infers each option from the ones before it.
  validateSearch: ({ ask }: { readonly ask?: unknown }) =>
    Predicate.isString(ask) ? { ask } : {},
  loader: ({ params }) => asksPage({ data: params.project }),
  shouldReload: reloadOnEnter,
  headers: () => branchPage,
  head: ({ params: { project } }) =>
    pageHead({
      title: `Asks · ${project}`,
      description: `${project}'s open asks: each one a want with a check, ready to claim.`,
    }),
  component: AsksPage,
  notFoundComponent: Unknown,
});
