import { Brand } from "@repo/brand";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { useEffect } from "react";

import { useSignedIn } from "../features/auth/session-slot.tsx";
import {
  markdownAlternateLink,
  markdownLink,
} from "../features/front/markdown.ts";
import { pageHead } from "../features/shared/head.ts";
import { AppLink } from "../features/shared/link.tsx";
import { ASKS_PATH, HOME_PATH } from "../features/shared/paths.ts";
import { branchPage } from "../server/cache-headers.ts";
import { serverClient } from "../server/client.ts";
import { landingHandler } from "../server/front-page.ts";

// `/`, the landing: the one page drawn outside the shell. It is the same
// page for every reader, so the edge may keep it; its server GET sends a
// reader who carries a session to `/home` before the page is drawn, and
// gives an agent `llms.txt`. A signed-in reader who reaches it by a link
// is moved on once the browser knows who they are.

/** What the platform is, in a sentence: the page's head and its lede. */
const ABOUT =
  "A git platform where a project says what it wants as asks, anyone may answer, and a change lands on main only by passing a typed gate.";

/** Where the page's Markdown is. */
const MARKDOWN = "/llms.txt";

/** The landing's headers: kept briefly, varied by `Accept`, its Markdown named. */
export const landingHeaders = () => ({
  ...branchPage,
  link: markdownLink(MARKDOWN),
  vary: "Accept",
});

/** The landing's head: the product's name, its sentence, and its Markdown. */
export const landingHead = () => ({
  ...pageHead({
    description: ABOUT,
    title: "A git platform with a typed gate",
  }),
  links: [markdownAlternateLink(MARKDOWN)],
});

/** A signed-in reader who came by a link goes on to their home. */
const useHomeOnceSignedIn = () => {
  const signedIn = useSignedIn();
  const navigate = useNavigate();

  useEffect(() => {
    if (signedIn) {
      void navigate({ replace: true, to: HOME_PATH });
    }
  }, [navigate, signedIn]);
};

const Landing = () => {
  useHomeOnceSignedIn();

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-6 py-12">
      <p className="text-want font-semibold">{Brand.name}</p>
      <h1 className="text-headline font-semibold">{ABOUT}</h1>
      <p>
        <AppLink to={ASKS_PATH}>See the open asks</AppLink>
      </p>
    </main>
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
