import { RegistryProvider, useAtomValue } from "@effect/atom-react";
import { Client } from "@repo/protocol/contracts";
import { Ask } from "@repo/protocol/domain/ask";
import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Option, Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";

import { askAtom } from "../../../client/ask.ts";
import { AskView } from "../../../features/ask/ask-page.tsx";
import {
  markdownAlternate,
  wantsMarkdown,
} from "../../../features/ask/markdown.ts";
import { NoSuchAsk, notFoundFor } from "../../../features/ask/refused.tsx";
import { pageTitle } from "../../../features/shared/layout.tsx";
import { serverClient } from "../../../server/client.ts";
import { AskPath, askMarkdownHandler } from "./{$ask}[.]md.ts";
import type { AskParams, ClientFor } from "./{$ask}[.]md.ts";

// The ask page: the brief, its fields and the lines that take it. The same
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

/** What the page's loader carries from the server, encoded: the ask, its brief, and when it was read. */
const AskPageData = Schema.Struct({
  ask: Ask,
  brief: Schema.NonEmptyString,
  now: Schema.DateTimeUtcFromString,
});

/** The ask for its page, or a not-found carrying the platform's refusal (a 404). */
export const readAsk = (params: AskParams) =>
  Effect.gen(function* () {
    const path = yield* Schema.decodeEffect(AskPath)(params).pipe(
      Effect.mapError(() => notFound())
    );

    const client = yield* Client;

    const read = yield* client.showAsk(path).pipe(
      Effect.catchTags({
        UnknownAsk: notFoundFor,
        UnknownProject: notFoundFor,
      })
    );

    return yield* Schema.encodeEffect(AskPageData)({
      ...read,
      now: yield* DateTime.now,
    });
  });

const askPage = createServerFn({ method: "GET" })
  .validator((params: AskParams) => params)
  .handler(({ data }) =>
    Effect.runPromise(readAsk(data).pipe(Effect.provide(serverClient(env))))
  );

const root = getRouteApi("__root__");

type AskRead = Pick<typeof AskPageData.Type, "ask" | "brief">;

/** The page over the ask's atom, which starts from what the loader read and refetches when its keys change. */
const FreshAsk = ({
  atom,
  now,
  platformUrl,
  read,
}: {
  readonly atom: ReturnType<typeof askAtom>;
  readonly now: DateTime.Utc;
  readonly platformUrl: string;
  readonly read: AskRead;
}) => {
  const { ask, brief } = Option.getOrElse(
    AsyncResult.value(useAtomValue(atom)),
    () => read
  );

  return (
    <AskView ask={ask} brief={brief} now={now} platformUrl={platformUrl} />
  );
};

const AskPage = () => {
  const { platformUrl } = root.useLoaderData();

  const { ask, brief, now } = Schema.decodeSync(AskPageData)(
    Route.useLoaderData()
  );

  const atom = askAtom(ask.project, ask.id);

  return (
    <RegistryProvider
      initialValues={[
        Atom.initialValue(atom, AsyncResult.success({ ask, brief })),
      ]}
      key={`${ask.project}/${ask.id}`}
    >
      <FreshAsk
        atom={atom}
        now={now}
        platformUrl={platformUrl}
        read={{ ask, brief }}
      />
    </RegistryProvider>
  );
};

export const Route = createFileRoute("/$project/asks/$ask")({
  // TanStack infers each option from the ones before it: the loader comes
  // first, so `head` reads its data.
  loader: ({ params }) => askPage({ data: params }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: pageTitle(
          loaderData === undefined ? "No such ask" : loaderData.ask.brief.want
        ),
      },
    ],
  }),
  headers: askPageHeaders,
  component: AskPage,
  notFoundComponent: NoSuchAsk,
  server: {
    handlers: {
      GET: askPageHandler((request) => serverClient(env, request)),
    },
  },
});
