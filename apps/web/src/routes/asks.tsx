import { useAtomMount, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Option, Predicate, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useMemo } from "react";

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

const LiveFront = ({
  data,
  filter,
  projects,
  signedIn,
}: {
  readonly data: FrontPageData;
  readonly filter: FrontFilter;
  readonly projects: readonly ProjectListing[] | undefined;
  readonly signedIn: boolean;
}) => {
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

  return (
    <FrontPageView
      entries={entries}
      events={events}
      filter={filter}
      now={data.now}
      parents={data.parents}
      projects={projects}
      stampsOf={stampsOf}
    />
  );
};

const FrontPage = () => {
  // `ask` is the selected row's, which the list reads from the address itself.
  const { ask: _selected, ...filter } = Route.useSearch();
  const loaded = Route.useLoaderData();

  const data = useMemo(
    () => Schema.decodeSync(FrontPageData)(loaded),
    [loaded]
  );

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
        projects={
          AsyncResult.isSuccess(listed) ? listed.value.projects : undefined
        }
        signedIn={signedIn}
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
