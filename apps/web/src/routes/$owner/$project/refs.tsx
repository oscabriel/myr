import { Client } from "@repo/protocol/contracts";
import { RefsView as Refs } from "@repo/protocol/domain/code";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Option, Schema } from "effect";

import { offsetOf, projectOf } from "../../../features/code/address.ts";
import { CodeNotFound } from "../../../features/code/not-found.tsx";
import { packageParamOf } from "../../../features/code/refs-param.ts";
import { RefsView } from "../../../features/code/refs-view.tsx";
import { pageHead } from "../../../features/shared/head.ts";
import { notFoundFor } from "../../../features/shared/refusals.ts";
import { branchPage } from "../../../server/cache-headers.ts";
import { serverClient } from "../../../server/client.ts";

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
      readRefsPage(data).pipe(
        Effect.map((refs) => ({ platformUrl: env.PUBLIC_PLATFORM_URL, refs })),
        Effect.provide(serverClient(env))
      )
    )
  );

const RefsPage = () => {
  const { platformUrl, refs: read } = Route.useLoaderData();
  const refs = Schema.decodeSync(Refs)(read);
  const search = Route.useSearch();

  return (
    <RefsView
      from={search.from ?? 0}
      package={search.package}
      platformUrl={platformUrl}
      refs={refs}
    />
  );
};

export const Route = createFileRoute("/$owner/$project/refs")({
  // The router writes back what this returns, dropping only `undefined`,
  // so the first page's address carries no `from`, and all the tags' no
  // `package`.
  validateSearch: (search: {
    readonly from?: unknown;
    readonly package?: unknown;
  }) => ({
    from: Option.getOrUndefined(offsetOf(search.from)),
    package: Option.getOrUndefined(packageParamOf(search.package)),
  }),
  loader: ({ params }) => refsPage({ data: params.project }),
  headers: () => branchPage,
  head: ({ params: { project } }) =>
    pageHead({
      title: `Refs · ${project}`,
      description: `${project}'s main, tags and forks.`,
    }),
  component: RefsPage,
  notFoundComponent: CodeNotFound,
});
