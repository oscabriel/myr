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
  staticData: { shell: "project" },
  loader: () => homePage(),
  shouldReload: reloadOnEnter,
  headers: homeHeaders,
  head: () => pageHead({ title: "Home" }),
  component: HomePage,
});
