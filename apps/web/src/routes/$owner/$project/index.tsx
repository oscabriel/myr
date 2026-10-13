import { useAtomMount, useAtomValue } from "@effect/atom-react";
import type { ProjectName } from "@repo/protocol/ids";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Option, Predicate, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";

import { projectCodeAtom } from "../../../client/code.ts";
import { projectEventsAtom, recentLandings } from "../../../client/events.ts";
import {
  asksAtom,
  projectLedgerAtom,
  projectPolicyAtom,
} from "../../../client/project.ts";
import { SeededAtoms, seedSuccess } from "../../../client/seeded.ts";
import type { Seed } from "../../../client/seeded.ts";
import { watchAtom } from "../../../client/watch.ts";
import { useSignedIn } from "../../../features/auth/session-slot.tsx";
import { ledeOf } from "../../../features/front/head.ts";
import {
  markdownAlternateLink,
  markdownLink,
} from "../../../features/front/markdown.ts";
import { useStamps } from "../../../features/front/stamps.ts";
import {
  ImportOffer,
  offerFor,
} from "../../../features/import/import-offer.tsx";
import { useImporter } from "../../../features/import/use-importer.tsx";
import {
  ProjectView,
  heldBackOf,
  homeListing,
} from "../../../features/project/project-page.tsx";
import { UnknownProjectView } from "../../../features/project/unknown-project.tsx";
import { askStates } from "../../../features/shared/ask-progress.ts";
import { pageHead } from "../../../features/shared/head.ts";
import { reloadOnEnter } from "../../../features/shared/shell/selection.ts";
import { branchPage } from "../../../server/cache-headers.ts";
import { serverClient } from "../../../server/client.ts";
import {
  ProjectPageData,
  decodeName,
  projectPageHandler,
  readProjectPage,
} from "../../../server/project-page.ts";

const projectPage = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(({ data }) =>
    Effect.runPromise(
      readProjectPage(data).pipe(Effect.provide(serverClient(env)))
    )
  );

const markdownOf = (name: string) =>
  Option.map(decodeName(name), (project) => `/${project}/llms.txt`);

// A path that cannot name a project names nothing, so no raw path text reaches a header.
export const projectPageHeaders = ({
  params,
}: {
  readonly params: { readonly project: string };
}): Readonly<Record<string, string>> =>
  Option.match(markdownOf(params.project), {
    onNone: () => ({ vary: "Accept" }),
    onSome: (href) => ({
      ...branchPage,
      link: markdownLink(href),
      vary: "Accept",
    }),
  });

export const projectPageHead = ({
  loaderData,
  params,
}: {
  readonly params: { readonly project: string };
  readonly loaderData?: typeof ProjectPageData.Encoded | undefined;
}) => {
  const text = loaderData?.code?.readme?.text;
  const lede = Predicate.isString(text) ? ledeOf(text) : undefined;

  return {
    ...pageHead({
      title: params.project,
      ...Option.match(Option.fromUndefinedOr(lede), {
        onNone: () => ({}),
        onSome: (description) => ({ description }),
      }),
    }),
    links: Option.match(markdownOf(params.project), {
      onNone: () => [],
      onSome: (href) => [markdownAlternateLink(href)],
    }),
  };
};

const root = getRouteApi("__root__");

const valueOr = <A, E, B>(
  read: AsyncResult.AsyncResult<A, E>,
  seeded: B | undefined,
  pick: (value: A) => B
): B | undefined =>
  Option.getOrElse(Option.map(AsyncResult.value(read), pick), () => seeded);

const LiveProject = ({
  data,
  platformUrl,
  signedIn,
}: {
  readonly data: ProjectPageData;
  readonly platformUrl: string;
  readonly signedIn: boolean;
}) => {
  const { project } = data;

  useAtomMount(watchAtom(project));

  const asksRead = useAtomValue(asksAtom(project));
  const asks = valueOr(asksRead, data.asks, ({ asks: listed }) => listed);

  const events = valueOr(
    useAtomValue(projectEventsAtom(project)),
    data.events,
    (read) => read
  );

  const ledger = valueOr(
    useAtomValue(projectLedgerAtom(project)),
    data.ledger,
    (read) => read
  );

  const code = valueOr(
    useAtomValue(projectCodeAtom(project)),
    data.code,
    (read) => read
  );

  const policyRead = valueOr(
    useAtomValue(projectPolicyAtom(project)),
    data.policy,
    (read) => read
  );

  const deciders = policyRead?.policy?.deciders;

  const reads = useMemo(
    () => new Map(events === undefined ? [] : [[project, events]]),
    [events, project]
  );

  const stamps = useStamps(reads)(project);
  const states = useMemo(() => askStates(events ?? []), [events]);
  const landings = useMemo(() => recentLandings(events ?? []), [events]);
  const [latest] = landings;

  return (
    <ProjectView
      asks={asks}
      code={code}
      deciders={deciders}
      heldBack={ledger === undefined ? undefined : heldBackOf(ledger)}
      importedFrom={policyRead?.importedFrom}
      landings={landings}
      lastLanded={latest?.landedAt}
      listing={homeListing({ asks, ledger, project })}
      now={data.now}
      parents={data.parents}
      platformUrl={platformUrl}
      signedIn={signedIn}
      stamps={stamps}
      states={states}
      unreachable={AsyncResult.isFailure(asksRead)}
    />
  );
};

const ProjectPage = () => {
  const loaded = Route.useLoaderData();

  const data = useMemo(
    () => Schema.decodeSync(ProjectPageData)(loaded),
    [loaded]
  );

  const { platformUrl } = root.useLoaderData();
  const signedIn = useSignedIn();
  const { project } = data;

  const seeds: readonly Seed[] = [
    ...(data.asks === undefined
      ? []
      : [seedSuccess(asksAtom(project), { asks: data.asks })]),
    ...(data.events === undefined
      ? []
      : [seedSuccess(projectEventsAtom(project), data.events)]),
    ...(data.ledger === undefined
      ? []
      : [seedSuccess(projectLedgerAtom(project), data.ledger)]),
    ...(data.code === undefined
      ? []
      : [seedSuccess(projectCodeAtom(project), data.code)]),
    ...(data.policy === undefined
      ? []
      : [seedSuccess(projectPolicyAtom(project), data.policy)]),
  ];

  return (
    <SeededAtoms id={project} seeds={seeds}>
      <LiveProject data={data} platformUrl={platformUrl} signedIn={signedIn} />
    </SeededAtoms>
  );
};

const Offer = ({ project }: { readonly project: ProjectName }) => {
  const importer = useImporter(project);

  return <ImportOffer importer={importer} project={project} />;
};

const Unknown = () => {
  const { project } = Route.useParams();

  return Option.match(offerFor(project), {
    onNone: () => <UnknownProjectView name={project} />,
    onSome: (offered) => <Offer project={offered} />,
  });
};

export const Route = createFileRoute("/$owner/$project/")({
  staticData: { shell: "project" },
  // TanStack infers each option from the ones before it.
  validateSearch: ({ ask }: { readonly ask?: unknown }) =>
    Predicate.isString(ask) ? { ask } : {},
  loader: ({ params }) => projectPage({ data: params.project }),
  shouldReload: reloadOnEnter,
  head: projectPageHead,
  headers: projectPageHeaders,
  component: ProjectPage,
  notFoundComponent: Unknown,
  server: {
    handlers: {
      GET: projectPageHandler(
        (request) => serverClient(env, request),
        env.PUBLIC_PLATFORM_URL
      ),
    },
  },
});
