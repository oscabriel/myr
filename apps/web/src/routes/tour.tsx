import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect } from "effect";

import { pageHead } from "../features/shared/head.ts";
import { readTourLive } from "../features/tour/read.ts";
import { TourView } from "../features/tour/tour-page.tsx";
import { TOUR_LEDE, TOUR_TITLE } from "../features/tour/words.ts";
import { branchPage } from "../server/cache-headers.ts";
import { serverClient } from "../server/client.ts";

const root = getRouteApi("__root__");

// Read as nobody (no cookie reaches the platform): whether anything is live is everyone's, so the page stays one the edge may keep.
const tourData = createServerFn({ method: "GET" }).handler(() =>
  Effect.runPromise(readTourLive.pipe(Effect.provide(serverClient(env))))
);

const Tour = () => {
  const { platformUrl } = root.useLoaderData();
  const live = Route.useLoaderData();

  return <TourView live={live} platformUrl={platformUrl} />;
};

export const tourHead = () =>
  pageHead({ description: TOUR_LEDE, title: TOUR_TITLE });

export const Route = createFileRoute("/tour")({
  staticData: { shell: "site" },
  loader: () => tourData(),
  head: tourHead,
  headers: () => branchPage,
  component: Tour,
});
