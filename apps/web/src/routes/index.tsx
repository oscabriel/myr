import {
  createFileRoute,
  getRouteApi,
  useRouter,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { Effect, Schema } from "effect";
import { useEffect, useMemo } from "react";

import { useSignedIn } from "../features/auth/session-slot.tsx";
import {
  markdownAlternateLink,
  markdownLink,
} from "../features/front/markdown.ts";
import { LandingView } from "../features/landing/landing-page.tsx";
import { LandingProjects } from "../features/landing/projects.ts";
import { readLandingProjects } from "../features/landing/read.ts";
import { LEDE } from "../features/landing/words.ts";
import { pageHead } from "../features/shared/head.ts";
import { HOME_PATH } from "../features/shared/paths.ts";
import { branchPage } from "../server/cache-headers.ts";
import { serverClient } from "../server/client.ts";
import { landingHandler } from "../server/front-page.ts";

const root = getRouteApi("__root__");

const MARKDOWN = "/llms.txt";

// Read as nobody (no cookie reaches the platform): the list ignores the caller, so the page stays one the edge may keep.
const landingData = createServerFn({ method: "GET" }).handler(() =>
  Effect.runPromise(
    readLandingProjects.pipe(
      Effect.flatMap(Schema.encodeEffect(LandingProjects)),
      Effect.provide(serverClient(env))
    )
  )
);

export const landingHeaders = () => ({
  ...branchPage,
  link: markdownLink(MARKDOWN),
  vary: "Accept",
});

export const landingHead = () => ({
  ...pageHead({
    description: LEDE,
    title: "A git platform with a typed gate",
  }),
  links: [markdownAlternateLink(MARKDOWN)],
});

const useHomeOnceSignedIn = () => {
  const signedIn = useSignedIn();
  const router = useRouter();

  useEffect(() => {
    if (signedIn) {
      void router.navigate({ replace: true, to: HOME_PATH });
    }
  }, [router, signedIn]);
};

const Landing = () => {
  useHomeOnceSignedIn();
  const { platformUrl } = root.useLoaderData();
  const { origin } = useRouter();
  const loaded = Route.useLoaderData();

  const projects = useMemo(
    () => Schema.decodeSync(LandingProjects)(loaded),
    [loaded]
  );

  return (
    <LandingView
      platformUrl={platformUrl}
      projects={projects}
      webUrl={origin}
    />
  );
};

export const Route = createFileRoute("/")({
  staticData: { shell: "site" },
  loader: () => landingData(),
  head: landingHead,
  headers: landingHeaders,
  component: Landing,
  server: {
    handlers: {
      GET: landingHandler(
        (request) => serverClient(env, request),
        env.PUBLIC_PLATFORM_URL
      ),
    },
  },
});
