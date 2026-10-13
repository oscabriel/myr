import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Schema } from "effect";
import { useMemo } from "react";

import {
  EXPLORE_LEDE,
  EXPLORE_TITLE,
  ExploreView,
} from "../features/explore/explore-page.tsx";
import { LandingProjects } from "../features/landing/projects.ts";
import { readEveryProject } from "../features/landing/read.ts";
import { pageHead } from "../features/shared/head.ts";
import { branchPage } from "../server/cache-headers.ts";
import { serverClient } from "../server/client.ts";

// Read as nobody (no cookie reaches the platform), so the page stays one the edge may keep.
const exploreData = createServerFn({ method: "GET" }).handler(() =>
  Effect.runPromise(
    readEveryProject.pipe(
      Effect.flatMap(Schema.encodeEffect(LandingProjects)),
      Effect.provide(serverClient(env))
    )
  )
);

export const exploreHeaders = () => branchPage;

const Explore = () => {
  const loaded = Route.useLoaderData();

  const projects = useMemo(
    () => Schema.decodeSync(LandingProjects)(loaded),
    [loaded]
  );

  return <ExploreView projects={projects} />;
};

export const Route = createFileRoute("/explore")({
  staticData: { shell: "site" },
  loader: () => exploreData(),
  head: () => pageHead({ description: EXPLORE_LEDE, title: EXPLORE_TITLE }),
  headers: exploreHeaders,
  component: Explore,
});
