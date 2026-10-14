import { Client } from "@repo/protocol/contracts";
import { CreditSummary } from "@repo/protocol/domain/record";
import { Handle } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Schema } from "effect";

import {
  NoSuchPersonView,
  PersonView,
} from "../../features/people/person-page.tsx";
import { pageHead } from "../../features/shared/head.ts";
import { branchPage } from "../../server/cache-headers.ts";
import { serverClient } from "../../server/client.ts";

const PersonPageData = Schema.Struct({
  credits: Schema.Array(CreditSummary),
  handle: Handle,
});

/**
 * The page arrives with its credits: an address that names no handle is not
 * found before anything is read.
 */
export const readPersonPage = (handle: string) =>
  Effect.gen(function* () {
    const person = yield* Effect.mapError(
      Schema.decodeEffect(Handle)(handle),
      () => notFound()
    );

    const client = yield* Client;
    const { credits } = yield* client.credits({ handle: person });

    return yield* Schema.encodeEffect(PersonPageData)({
      credits,
      handle: person,
    });
  });

const personPage = createServerFn({ method: "GET" })
  .validator((handle: string) => handle)
  .handler(({ data }) =>
    Effect.runPromise(
      readPersonPage(data).pipe(Effect.provide(serverClient(env)))
    )
  );

const PersonPage = () => {
  const read = Schema.decodeSync(PersonPageData)(Route.useLoaderData());

  return <PersonView credits={read.credits} handle={read.handle} />;
};

export const Route = createFileRoute("/people/$handle")({
  staticData: { shell: "project" },
  component: PersonPage,
  headers: () => branchPage,
  head: ({ params }) =>
    pageHead({
      description: `What ${params.handle} is credited for, by project and area.`,
      title: params.handle,
    }),
  loader: ({ params }) => personPage({ data: params.handle }),
  notFoundComponent: NoSuchPersonView,
});
