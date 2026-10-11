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

// `/`, the landing: the one page drawn outside the shell. It is the same
// page for every reader, so the edge may keep it; its server GET sends a
// reader who carries a session to `/home` before the page is drawn, and
// gives an agent `llms.txt`. A signed-in reader who reaches it by a link
// is moved on once the browser knows who they are. Its projects are read
// on the server as nobody, so every reader, script or not, is sent the
// same page with its projects in.

const root = getRouteApi("__root__");

/** Where the page's Markdown is. */
const MARKDOWN = "/llms.txt";

/**
 * The projects to read, as nobody (the client without the request, so no
 * cookie reaches the platform), encoded for the loader to carry. The list
 * ignores the caller, so nobody's read is everyone's, and the page stays
 * one the edge may keep.
 */
const landingData = createServerFn({ method: "GET" }).handler(() =>
  Effect.runPromise(
    readLandingProjects.pipe(
      Effect.flatMap(Schema.encodeEffect(LandingProjects)),
      Effect.provide(serverClient(env))
    )
  )
);

/** The landing's headers: kept briefly, varied by `Accept`, its Markdown named. */
export const landingHeaders = () => ({
  ...branchPage,
  link: markdownLink(MARKDOWN),
  vary: "Accept",
});

/** The landing's head: its title, its own sentence to unfurl with, and its Markdown. */
export const landingHead = () => ({
  ...pageHead({
    description: LEDE,
    title: "A git platform with a typed gate",
  }),
  links: [markdownAlternateLink(MARKDOWN)],
});

/** A signed-in reader who came by a link goes on to their home. */
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
  staticData: { shell: "bare" },
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
