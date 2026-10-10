import { useAtomValue } from "@effect/atom-react";
import { Brand } from "@repo/brand";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useHydrated,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { AsyncResult } from "effect/reactivity";
import type { ReactNode } from "react";

import monoFont from "../assets/fonts/jetbrains-mono-latin.woff2?url";
import sansFont from "../assets/fonts/public-sans-latin.woff2?url";
import { projectsAtom } from "../client/front.ts";
import { todayAtom } from "../client/today.ts";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import { MANIFEST_PATH } from "../features/agents/manifest.ts";
import { useSignedIn } from "../features/auth/session-slot.tsx";
import { AppShell } from "../features/shared/shell/app-shell.tsx";
import { RailCount } from "../features/shared/shell/rail.tsx";
import { themeColors } from "../features/shared/theme.ts";

import styles from "../styles.css?url";

// The document every page shares, and the shell inside it: the rail, the
// bars, and each page's own panes (its `Workspace`). The document is the
// route's shell component, so a failure in this route's own read still
// draws inside a whole document. Pages read the site's facts from this
// route's loader data (`getRouteApi("__root__").useLoaderData()`).

/**
 * What every page may need from the Worker's env: where a browser reaches
 * the platform (its git remotes and the CLI's install line). Read on the
 * server; the loader's data rides into the page with the first render.
 */
const siteFacts = createServerFn({ method: "GET" }).handler(() => ({
  platformUrl: env.PUBLIC_PLATFORM_URL,
}));

/**
 * The browser's chrome colour for each scheme. Rendered into the head
 * directly, not through `rootHead`: both metas are named `theme-color`, and
 * TanStack's `HeadContent` keeps one meta per name.
 */
export const ThemeColors = () => (
  <>
    <meta
      content={themeColors.light}
      media="(prefers-color-scheme: light)"
      name="theme-color"
    />
    <meta
      content={themeColors.dark}
      media="(prefers-color-scheme: dark)"
      name="theme-color"
    />
  </>
);

const Document = ({ children }: Readonly<{ children: ReactNode }>) => (
  <html lang="en">
    <head>
      <HeadContent />
      <ThemeColors />
    </head>
    <body>
      {children}
      <Scripts />
    </body>
  </html>
);

/** The decider's Today, read in the browser for the rail's count. */
const railToday = todayAtom();

const TodayWaiting = () => {
  const today = useAtomValue(railToday);

  if (!AsyncResult.isSuccess(today)) {
    return null;
  }

  const waiting = today.value.decisions.length + today.value.overflow;

  return waiting === 0 ? null : (
    <RailCount count={waiting} of="decisions waiting" />
  );
};

/**
 * How many decisions wait on the signed-in decider, beside Today in the
 * rail: read once the page is up and only for someone signed in, never on
 * the server, so it never holds a page back.
 */
const TodayCount = () => {
  const hydrated = useHydrated();
  const signedIn = useSignedIn();

  return hydrated && signedIn ? <TodayWaiting /> : null;
};

const Root = () => {
  // Read in the browser after the page is up; the rail draws without it first.
  const listed = useAtomValue(projectsAtom);

  return (
    <TooltipProvider>
      <AppShell
        projects={
          AsyncResult.isSuccess(listed) ? listed.value.projects : undefined
        }
        todayCount={<TodayCount />}
      >
        <Outlet />
      </AppShell>
    </TooltipProvider>
  );
};

/**
 * What a shared link to any page unfurls with until the page gives its own
 * (`pageHead`): what the platform is, in a sentence.
 */
export const SITE_DESCRIPTION =
  "A git platform where a project says what it wants as asks, anyone may answer, and a change lands on main only by passing a typed gate, with credit for every person involved.";

/** The site's icon, drawn to scale (`public/icons/icon.svg`). */
const ICON_PATH = "/icons/icon.svg";

/**
 * A font every page draws with, fetched with the page rather than once the
 * stylesheet names it. Fonts are fetched without credentials whatever their
 * origin, so the preload says so too, or the browser fetches the file twice.
 */
const fontPreload = (href: string) =>
  ({
    as: "font",
    crossOrigin: "anonymous",
    href,
    rel: "preload",
    type: "font/woff2",
  }) as const;

/**
 * The document's head on every page: the stylesheet, the latin fonts (the
 * latin-ext files load only when a page needs them), the manifest, the icon
 * and the metas. TanStack keeps one meta per `name` (the last a route gives),
 * so each meta here must have a name of its own; the two theme colours are
 * `ThemeColors`, in the document itself.
 */
export const rootHead = () => ({
  links: [
    { href: styles, rel: "stylesheet" },
    fontPreload(sansFont),
    fontPreload(monoFont),
    // Written from `Brand.name` at each build by `vite.config.ts`.
    { href: MANIFEST_PATH, rel: "manifest" },
    { href: ICON_PATH, rel: "icon", type: "image/svg+xml" },
  ],
  meta: [
    { charSet: "utf-8" },
    { content: "width=device-width, initial-scale=1", name: "viewport" },
    { content: "light dark", name: "color-scheme" },
    { title: Brand.name },
    { content: SITE_DESCRIPTION, name: "description" },
    { content: Brand.name, property: "og:title" },
    { content: SITE_DESCRIPTION, property: "og:description" },
    { content: "website", property: "og:type" },
    { content: Brand.name, property: "og:site_name" },
  ],
});

export const Route = createRootRoute({
  component: Root,
  head: rootHead,
  shellComponent: Document,
  loader: () => siteFacts(),
  // The facts are the stage's, fixed for the Worker's life: fetch them once.
  staleTime: Number.POSITIVE_INFINITY,
});
