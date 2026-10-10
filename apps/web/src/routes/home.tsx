import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { Effect, Schema } from "effect";

import { HomeView } from "../features/home/home-page.tsx";
import { HomePageData, readHome } from "../features/home/read.ts";
import { pageHead } from "../features/shared/head.ts";
import { reloadOnEnter } from "../features/shared/shell/selection.ts";
import { personalPage } from "../server/cache-headers.ts";
import { serverClient } from "../server/client.ts";

// `/home`: the signed-in reader's own page, where the landing sends them.
// The loader reads it on the server with the reader's own session (their
// cookie goes with the call), so the page arrives with its rows. A page
// about its reader is kept by no cache.

/** A page about its reader, kept by no cache. */
export const homeHeaders = () => personalPage;

const homePage = createServerFn({ method: "GET" }).handler(() =>
  Effect.runPromise(
    readHome.pipe(Effect.provide(serverClient(env, getRequest())))
  )
);

const HomePage = () => {
  const data = Schema.decodeSync(HomePageData)(Route.useLoaderData());

  return <HomeView now={data.now} read={data.read} />;
};

export const Route = createFileRoute("/home")({
  loader: () => homePage(),
  shouldReload: reloadOnEnter,
  headers: homeHeaders,
  head: () => pageHead({ title: "Home" }),
  component: HomePage,
});
