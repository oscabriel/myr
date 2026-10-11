import { useAtomMount, useAtomValue } from "@effect/atom-react";
import type { Ask } from "@repo/protocol/domain/ask";
import { AskId } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import {
  createFileRoute,
  getRouteApi,
  useHydrated,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Option, Predicate, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";
import type { ReactNode } from "react";

import { selectedAskAtom } from "../../../client/ask.ts";
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
import { withProjectName } from "../../../server/addresses.ts";
import { branchPage } from "../../../server/cache-headers.ts";
import { serverClient } from "../../../server/client.ts";
import {
  ProjectPageData,
  decodeName,
  projectPageHandler,
  readProjectPage,
} from "../../../server/project-page.ts";

// A project's home, which is its list of asks. The loader reads, on the
// server and at once, the project's asks, its own ledger (its posture), its
// events (each ask's progress, a family's marks, its landings), its policy
// (who decides) and its root folder with its README, then each family's
// parent in full; so the page, and an agent fetching it, arrive with the
// asks and the README. A read the platform cannot give now leaves its
// section to the browser; an address naming no project is a 404 that shows
// the platform's `UnknownProject` refusal. The list of projects is never
// read here. The same URL answers `Accept: text/markdown` with the
// project's `llms.txt`.

const projectPage = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(({ data }) =>
    Effect.runPromise(
      readProjectPage(data).pipe(Effect.provide(serverClient(env)))
    )
  );

/** Where a project's Markdown is; none for a name that can name no project. */
const markdownOf = (name: string) =>
  Option.map(decodeName(name), (project) => `/${project}/llms.txt`);

/**
 * The page's headers: varied by `Accept`; for a name that can be a
 * project's, kept briefly with its Markdown named. A path that cannot names
 * nothing, so no raw path text reaches a header.
 */
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

/** The page's head: its name, its README's first sentence, and its Markdown. */
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

/**
 * The selected ask in full, read in the browser once it is selected. It
 * wraps the page whether or not a row is selected, so selecting one never
 * remounts the list (and loses the row the keys rest on).
 */
const WithFull = ({
  children,
  pick,
}: {
  readonly pick:
    | { readonly ask: AskId; readonly project: ProjectName }
    | undefined;
  readonly children: (full: Ask | undefined) => ReactNode;
}) => {
  const read = useAtomValue(selectedAskAtom(pick));

  return children(AsyncResult.isSuccess(read) ? read.value.ask : undefined);
};

const decodeAsk = Schema.decodeUnknownOption(AskId);

/** An atom's value once it has one, else what the loader read. */
const valueOr = <A, E, B>(
  read: AsyncResult.AsyncResult<A, E>,
  seeded: B | undefined,
  pick: (value: A) => B
): B | undefined =>
  Option.getOrElse(Option.map(AsyncResult.value(read), pick), () => seeded);

/** The page over its atoms, each section as its read arrives, all kept live. */
const LiveProject = ({
  data,
  platformUrl,
  selected,
  signedIn,
}: {
  readonly data: ProjectPageData;
  readonly platformUrl: string;
  readonly selected: string | undefined;
  readonly signedIn: boolean;
}) => {
  const { project } = data;
  const hydrated = useHydrated();

  // Live: each event the project commits makes these reads fetch again.
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

  const view = (selectedAsk?: Ask) => (
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
      postureLabel={ledger?.postureLabel}
      selectedAsk={selectedAsk}
      signedIn={signedIn}
      stamps={stamps}
      states={states}
      unreachable={AsyncResult.isFailure(asksRead)}
    />
  );

  const picked = Option.filter(decodeAsk(selected), (ask) =>
    (asks ?? []).some((listing) => listing.ask === ask)
  );

  return (
    <WithFull
      pick={
        hydrated && Option.isSome(picked)
          ? { ask: picked.value, project }
          : undefined
      }
    >
      {view}
    </WithFull>
  );
};

const ProjectPage = () => {
  const loaded = Route.useLoaderData();

  const data = useMemo(
    () => Schema.decodeSync(ProjectPageData)(loaded),
    [loaded]
  );

  const { ask } = Route.useSearch();
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
      <LiveProject
        data={data}
        platformUrl={platformUrl}
        selected={ask}
        signedIn={signedIn}
      />
    </SeededAtoms>
  );
};

/** The import offer for `project`, wired. */
const Offer = ({ project }: { readonly project: ProjectName }) => {
  const importer = useImporter(project);

  return <ImportOffer importer={importer} project={project} />;
};

/**
 * No project at this address: at a source namespace's
 * (`/github.com/pallets/click`) the import offer, else the not-found.
 */
const Unknown = () => {
  const { project } = Route.useParams();

  return Option.match(offerFor(project), {
    onNone: () => <UnknownProjectView name={project} />,
    onSome: (offered) => <Offer project={offered} />,
  });
};

export const Route = createFileRoute("/$owner/$project/")({
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
      GET: withProjectName(
        projectPageHandler(
          (request) => serverClient(env, request),
          env.PUBLIC_PLATFORM_URL
        )
      ),
    },
  },
});
