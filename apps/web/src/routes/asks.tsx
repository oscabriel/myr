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

import { selectedAskAtom } from "../client/ask.ts";
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

const TITLE = "Open asks";

const MARKDOWN = "/llms.txt";

const frontPageData = createServerFn({ method: "GET" }).handler(() =>
  Effect.runPromise(readFrontPage.pipe(Effect.provide(serverClient(env))))
);

export const frontPageHeaders = () => ({
  ...branchPage,
  link: markdownLink(MARKDOWN),
  vary: "Accept",
});

export const frontPageHead = () => ({
  ...pageHead({ description: EXPLAINER, title: TITLE }),
  links: [markdownAlternateLink(MARKDOWN)],
});

const everyAsk = frontPageAtom({});

const root = getRouteApi("__root__");

// Wraps the page whether or not a row is selected, so selecting one never remounts the list.
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

  return (
    <WithFull pick={hydrated ? Option.getOrUndefined(picked) : undefined}>
      {view}
    </WithFull>
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

export const Route = createFileRoute("/asks")({
  staticData: { shell: "site" },
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
