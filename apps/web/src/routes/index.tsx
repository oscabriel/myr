import { useAtomValue } from "@effect/atom-react";
import {
  createFileRoute,
  getRouteApi,
  useRouter,
} from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { useEffect } from "react";

import { projectsAtom } from "../client/front.ts";
import { useSignedIn } from "../features/auth/session-slot.tsx";
import {
  markdownAlternateLink,
  markdownLink,
} from "../features/front/markdown.ts";
import { LandingView } from "../features/landing/landing-page.tsx";
import { landingProjects } from "../features/landing/projects.ts";
import { pageHead } from "../features/shared/head.ts";
import { HOME_PATH } from "../features/shared/paths.ts";
import { branchPage } from "../server/cache-headers.ts";
import { serverClient } from "../server/client.ts";
import { landingHandler } from "../server/front-page.ts";

// `/`, the landing: the one page drawn outside the shell. It is the same
// page for every reader, so the edge may keep it; its server GET sends a
// reader who carries a session to `/home` before the page is drawn, and
// gives an agent `llms.txt`. A signed-in reader who reaches it by a link
// is moved on once the browser knows who they are. Its projects are the
// rail's read, in the browser, so every reader is sent the same page.

const root = getRouteApi("__root__");

/** Where the page's Markdown is. */
const MARKDOWN = "/llms.txt";

/** The landing's headers: kept briefly, varied by `Accept`, its Markdown named. */
export const landingHeaders = () => ({
  ...branchPage,
  link: markdownLink(MARKDOWN),
  vary: "Accept",
});

/** The landing's head: its title and its Markdown; it unfurls with the site's own sentence. */
export const landingHead = () => ({
  ...pageHead({
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
  const projects = landingProjects(useAtomValue(projectsAtom));

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
