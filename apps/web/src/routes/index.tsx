import { useAtomMount, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { Ask } from "@repo/protocol/domain/ask";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { AskId } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import {
  createFileRoute,
  getRouteApi,
  useHydrated,
  useRouter,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Array as Arr, Effect, Option, Predicate, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";

import { askAtom } from "../client/ask.ts";
import { projectEventsAtom } from "../client/events.ts";
import { frontPageAtom, projectsAtom } from "../client/front.ts";
import {
  familyEventsAtom,
  followedAtom,
  projectsKey,
} from "../client/project.ts";
import { SeededAtoms, seedSuccess } from "../client/seeded.ts";
import type { Seed } from "../client/seeded.ts";
import { useSignedIn } from "../features/auth/session-slot.tsx";
import { readFilter } from "../features/front/filter.ts";
import type { FrontFilter } from "../features/front/filter.ts";
import { FrontPageView } from "../features/front/front-page.tsx";
import { EXPLAINER } from "../features/front/head.ts";
import {
  markdownAlternateLink,
  markdownLink,
} from "../features/front/markdown.ts";
import { useStamps } from "../features/front/stamps.ts";
import { pageHead } from "../features/shared/head.ts";
import { reloadOnEnter } from "../features/shared/shell/selection.ts";
import { branchPage } from "../server/cache-headers.ts";
import { serverClient } from "../server/client.ts";
import {
  FrontPageData,
  frontPageHandler,
  readFrontPage,
} from "../server/front-page.ts";

// The front page: every open ask, read on the server by the loader, so the
// page (and an agent fetching it) arrives with its asks; narrowed here by
// the address's search. The whole list is read, so the filter offers every
// kind. The list of projects (each group's posture) is the browser's read,
// never the loader's: it may arrive after the rows, and moves none of them.
// The same URL answers `Accept: text/markdown` with `llms.txt`.

const TITLE = "Open asks";

/** Where the page's Markdown is. */
const MARKDOWN = "/llms.txt";

const frontPageData = createServerFn({ method: "GET" }).handler(() =>
  Effect.runPromise(readFrontPage.pipe(Effect.provide(serverClient(env))))
);

/** The page's headers: kept briefly, varied by `Accept`, its Markdown named. */
export const frontPageHeaders = () => ({
  ...branchPage,
  link: markdownLink(MARKDOWN),
  vary: "Accept",
});

/** The page's head: its title, its one sentence, and its Markdown. */
export const frontPageHead = () => ({
  ...pageHead({ description: EXPLAINER, title: TITLE }),
  links: [markdownAlternateLink(MARKDOWN)],
});

/** The open asks, unfiltered: the page narrows them, so its filter can offer every kind. */
const everyAsk = frontPageAtom({});

const root = getRouteApi("__root__");

/** The selected ask in full, read in the browser once it is selected. */
const WithFull = ({
  ask,
  children,
  project,
}: {
  readonly ask: AskId;
  readonly project: ProjectName;
  readonly children: (full: Ask | undefined) => ReactNode;
}) => {
  const read = useAtomValue(askAtom(project, ask));

  return children(AsyncResult.isSuccess(read) ? read.value.ask : undefined);
};

const decodeAsk = Schema.decodeUnknownOption(AskId);

/** The page over its atoms, which start from what the loader read and stay live. */
const LiveFront = ({
  data,
  filter,
  platformUrl,
  projects,
  selected,
  signedIn,
  webUrl,
}: {
  readonly data: FrontPageData;
  readonly filter: FrontFilter;
  readonly platformUrl: string;
  readonly projects: readonly ProjectListing[] | undefined;
  readonly selected: string | undefined;
  readonly signedIn: boolean;
  readonly webUrl: string;
}) => {
  const hydrated = useHydrated();
  const key = projectsKey(data.events.map(({ project }) => project));
  const refresh = useAtomRefresh(everyAsk);

  // Live: each family's project, followed while the page is open.
  useAtomMount(followedAtom(key));

  // The loader read as anyone; once someone is signed in, read who may take what for them.
  useEffect(() => {
    if (signedIn) {
      refresh();
    }
  }, [refresh, signedIn]);

  const { entries } = Option.getOrElse(
    AsyncResult.value(useAtomValue(everyAsk)),
    () => data
  );

  const events = useAtomValue(familyEventsAtom(key));
  const stampsOf = useStamps(events);

  const picked = Option.flatMap(decodeAsk(selected), (ask) =>
    Option.map(
      Arr.findFirst(entries, (entry) => entry.ask.ask === ask),
      (entry) => ({ ask, project: entry.project })
    )
  );

  const view = (selectedAsk?: Ask) => (
    <FrontPageView
      entries={entries}
      events={events}
      filter={filter}
      now={data.now}
      parents={data.parents}
      platformUrl={platformUrl}
      projects={projects}
      selectedAsk={selectedAsk}
      stampsOf={stampsOf}
      webUrl={webUrl}
    />
  );

  return hydrated && Option.isSome(picked) ? (
    <WithFull ask={picked.value.ask} project={picked.value.project}>
      {view}
    </WithFull>
  ) : (
    view()
  );
};

const FrontPage = () => {
  const { ask, ...filter } = Route.useSearch();
  const loaded = Route.useLoaderData();

  const data = useMemo(
    () => Schema.decodeSync(FrontPageData)(loaded),
    [loaded]
  );

  const { platformUrl } = root.useLoaderData();
  const { origin } = useRouter();

  // The root's own reads, in the registry it shares with the shell.
  const listed = useAtomValue(projectsAtom);
  const signedIn = useSignedIn();

  const seeds: readonly Seed[] = [
    seedSuccess(everyAsk, { entries: data.entries }),
    ...data.events.map(({ events, project }) =>
      seedSuccess(projectEventsAtom(project), events)
    ),
  ];

  return (
    <SeededAtoms id="front" seeds={seeds}>
      <LiveFront
        data={data}
        filter={filter}
        platformUrl={platformUrl}
        projects={
          AsyncResult.isSuccess(listed) ? listed.value.projects : undefined
        }
        selected={ask}
        signedIn={signedIn}
        webUrl={origin}
      />
    </SeededAtoms>
  );
};

/** The filter, and the selected ask, from the address. */
const readSearch = (search: {
  readonly ask?: unknown;
  readonly kind?: unknown;
  readonly project?: unknown;
  readonly reserved?: unknown;
  readonly take?: unknown;
}) => ({
  ...readFilter(search),
  ...Option.match(Option.liftPredicate(search.ask, Predicate.isString), {
    onNone: () => ({}),
    onSome: (ask) => ({ ask }),
  }),
});

export const Route = createFileRoute("/")({
  // TanStack infers each option from the ones before it.
  validateSearch: readSearch,
  loader: () => frontPageData(),
  shouldReload: reloadOnEnter,
  head: frontPageHead,
  headers: frontPageHeaders,
  component: FrontPage,
  server: {
    handlers: {
      GET: frontPageHandler(
        (request) => serverClient(env, request),
        env.PUBLIC_PLATFORM_URL
      ),
    },
  },
});
