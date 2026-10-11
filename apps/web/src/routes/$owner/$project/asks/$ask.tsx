import { useAtomMount, useAtomValue } from "@effect/atom-react";
import type { Handle } from "@repo/protocol/ids";
import {
  createFileRoute,
  getRouteApi,
  useParams,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { verdictAtom } from "../../../../client/answer.ts";
import { askAtom } from "../../../../client/ask.ts";
import { askStates, projectEventsAtom } from "../../../../client/events.ts";
import { SeededAtoms, seedSuccess } from "../../../../client/seeded.ts";
import { watchAtom } from "../../../../client/watch.ts";
import { AskPageData, readAsk } from "../../../../features/answer/reads.ts";
import { AskView } from "../../../../features/ask/ask-page.tsx";
import {
  markdownAlternate,
  wantsMarkdown,
} from "../../../../features/ask/markdown.ts";
import { NoSuchAsk } from "../../../../features/ask/refused.tsx";
import { whoAtom } from "../../../../features/auth/who.ts";
import { pageHead } from "../../../../features/shared/head.ts";
import { useProjectList } from "../../../../features/shared/shell/context.ts";
import { withProjectName } from "../../../../server/addresses.ts";
import { branchPage } from "../../../../server/cache-headers.ts";
import { serverClient } from "../../../../server/client.ts";
import { AskPath, askMarkdownHandler } from "./{$ask}[.]md.ts";
import type { AskParams, ClientFor } from "./{$ask}[.]md.ts";

// The ask page: where the ask stands, its brief, its check and its answers,
// and the lines that take it; live while open. The same
// URL answers `Accept: text/markdown` with the brief as Markdown (the GET
// handler below), and its `.md` twin always does (`{$ask}[.]md.ts`).

/**
 * The ask page's GET, as a function of its client: a request that asks for
 * Markdown gets the ask's Markdown, as at its `.md` URL; any other falls
 * through to the page.
 */
export const askPageHandler =
  (clientFor: ClientFor) =>
  <Next,>({
    next,
    params,
    request,
  }: {
    readonly next: () => Next;
    readonly params: AskParams;
    readonly request: Request;
  }): Promise<Response> | Next =>
    wantsMarkdown(request)
      ? askMarkdownHandler(clientFor)({ params, request })
      : next();

/**
 * The page's headers: that the URL answers by `Accept`, and, for a path that
 * can name an ask, its Markdown as an alternate. A path that cannot (a 404)
 * names none, so no raw path text reaches a header.
 */
export const askPageHeaders = ({
  params,
}: {
  readonly params: AskParams;
}): Readonly<Record<string, string>> =>
  Option.match(Schema.decodeOption(AskPath)(params), {
    onNone: () => ({ vary: "Accept" }),
    onSome: ({ ask, project }) => ({
      link: markdownAlternate(project, ask),
      vary: "Accept",
    }),
  });

const askPage = createServerFn({ method: "GET" })
  .validator((params: AskParams) => params)
  .handler(({ data }) =>
    Effect.runPromise(readAsk(data).pipe(Effect.provide(serverClient(env))))
  );

const root = getRouteApi("__root__");

/**
 * The page over its atoms, which start from what the loader read and read
 * again as the project's events arrive: the ask, its latest verdict, and
 * the events the fold reads.
 */
const FreshAsk = ({
  platformUrl,
  read,
  viewer,
}: {
  readonly platformUrl: string;
  readonly read: AskPageData;
  readonly viewer: Handle | undefined;
}) => {
  const { project } = read.ask;

  // Live: each event the project hears reads again what it changed.
  useAtomMount(watchAtom(project));

  const { ask, brief } = Option.getOrElse(
    AsyncResult.value(useAtomValue(askAtom(project, read.ask.id))),
    () => read
  );

  const { verdict } = Option.getOrElse(
    AsyncResult.value(useAtomValue(verdictAtom(project, read.ask.id))),
    () => read
  );

  // The replay as the browser reads it, once it has; until then the
  // server's, which holds the same events about these asks.
  const events = Option.getOrElse(
    AsyncResult.value(useAtomValue(projectEventsAtom(project))),
    () => read.events
  );

  const posture = useProjectList()?.find(
    (listing) => listing.project === project
  )?.posture;

  return (
    <AskView
      ask={ask}
      brief={brief}
      check={read.check}
      now={read.now}
      parent={read.parent}
      platformUrl={platformUrl}
      posture={posture}
      states={askStates(events)}
      verdict={verdict}
      viewer={viewer}
    />
  );
};

const AskPage = () => {
  const { platformUrl } = root.useLoaderData();
  const read = Schema.decodeSync(AskPageData)(Route.useLoaderData());
  const who = useAtomValue(whoAtom);
  const { ask, brief, verdict } = read;

  return (
    <SeededAtoms
      id={`${ask.project}/${ask.id}`}
      seeds={[
        seedSuccess(askAtom(ask.project, ask.id), { ask, brief }),
        seedSuccess(
          verdictAtom(ask.project, ask.id),
          verdict === undefined ? {} : { verdict }
        ),
      ]}
    >
      <FreshAsk
        platformUrl={platformUrl}
        read={read}
        viewer={
          AsyncResult.isSuccess(who)
            ? Option.getOrUndefined(who.value)
            : undefined
        }
      />
    </SeededAtoms>
  );
};

const AskNotFound = ({ data }: { readonly data?: unknown }) => {
  const { project } = useParams({ strict: false });

  return <NoSuchAsk data={data} project={project} />;
};

export const Route = createFileRoute("/$owner/$project/asks/$ask")({
  // TanStack infers each option from the ones before it: the loader comes
  // first, so `head` reads its data.
  loader: ({ params }) => askPage({ data: params }),
  head: ({ loaderData, params }) =>
    loaderData === undefined
      ? pageHead({ title: "No such ask" })
      : pageHead({
          description: loaderData.ask.brief.want,
          title: `${params.ask} · ${params.project}`,
        }),
  // An ask moves with each claim and landing: kept briefly, asked again.
  headers: (context) => ({ ...branchPage, ...askPageHeaders(context) }),
  component: AskPage,
  notFoundComponent: AskNotFound,
  server: {
    handlers: {
      GET: withProjectName(
        askPageHandler((request) => serverClient(env, request))
      ),
    },
  },
});
