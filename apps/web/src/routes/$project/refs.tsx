import { Client } from "@repo/protocol/contracts";
import { RefsView as Refs } from "@repo/protocol/domain/code";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Option, Schema } from "effect";

import { notFoundFor } from "../../features/ask/refused.tsx";
import { offsetOf, projectOf } from "../../features/code/address.ts";
import { CodeNotFound } from "../../features/code/not-found.tsx";
import { RefsView } from "../../features/code/refs-view.tsx";
import { pageTitle } from "../../features/shared/layout.tsx";
import { serverClient } from "../../server/client.ts";

// Main, the tags and the forks, read on the server; `?from=` pages the
// tags.

/** The refs for their page, or a not-found carrying the platform's refusal. */
export const readRefsPage = (name: string) =>
  Effect.gen(function* () {
    const project = yield* Effect.fromOption(projectOf(name));
    const client = yield* Client;

    const refs = yield* client
      .listRefs({ project })
      .pipe(Effect.catchTag("UnknownProject", notFoundFor));

    return yield* Schema.encodeEffect(Refs)(refs);
  }).pipe(Effect.catchTag("NoSuchElementError", () => Effect.fail(notFound())));

const refsPage = createServerFn({ method: "GET" })
  .validator((name: string) => name)
  .handler(({ data }) =>
    Effect.runPromise(
      readRefsPage(data).pipe(Effect.provide(serverClient(env)))
    )
  );

const RefsPage = () => {
  const refs = Schema.decodeSync(Refs)(Route.useLoaderData());
  const { from } = Route.useSearch();

  return <RefsView from={from ?? 0} refs={refs} />;
};

export const Route = createFileRoute("/$project/refs")({
  // The router writes back what this returns, dropping only `undefined`,
  // so the first page's address carries no `from`.
  validateSearch: (search: { readonly from?: unknown }) => ({
    from: Option.getOrUndefined(offsetOf(search.from)),
  }),
  loader: ({ params }) => refsPage({ data: params.project }),
  head: ({ params: { project } }) => ({
    meta: [{ title: pageTitle(`${project}: refs`) }],
  }),
  component: RefsPage,
  notFoundComponent: CodeNotFound,
});
