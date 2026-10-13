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
import { LandingNow } from "../features/landing/landing-now.ts";
import { LandingView } from "../features/landing/landing-page.tsx";
import { readLandingNow } from "../features/landing/read.ts";
import { LEDE } from "../features/landing/words.ts";
import { pageHead } from "../features/shared/head.ts";
import { INBOX_PATH } from "../features/shared/paths.ts";
import { branchPage } from "../server/cache-headers.ts";
import { serverClient } from "../server/client.ts";
import { landingHandler } from "../server/front-page.ts";

const root = getRouteApi("__root__");

const MARKDOWN = "/llms.txt";

// Read as nobody (no cookie reaches the platform): the list ignores the caller, so the page stays one the edge may keep.
const landingData = createServerFn({ method: "GET" }).handler(() =>
  Effect.runPromise(
    readLandingNow.pipe(
      Effect.flatMap(Schema.encodeEffect(LandingNow)),
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

const useInboxOnceSignedIn = () => {
  const signedIn = useSignedIn();
  const router = useRouter();

  useEffect(() => {
    if (signedIn) {
      void router.navigate({ replace: true, to: INBOX_PATH });
    }
  }, [router, signedIn]);
};

const Landing = () => {
  useInboxOnceSignedIn();
  const { platformUrl } = root.useLoaderData();
  const { origin } = useRouter();
  const loaded = Route.useLoaderData();

  const landings = useMemo(
    () => Schema.decodeSync(LandingNow)(loaded),
    [loaded]
  );

  return (
    <LandingView
      landings={landings}
      platformUrl={platformUrl}
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
