import { useAtomValue } from "@effect/atom-react";
import sansFont from "@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2?url";
import monoFont from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url";
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

import { projectsAtom } from "../client/front.ts";
import { todayAtom } from "../client/today.ts";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import { MANIFEST_PATH } from "../features/agents/manifest.ts";
import { useSignedIn } from "../features/auth/session-slot.tsx";
import { AppShell } from "../features/shared/shell/app-shell.tsx";
import { RailCount } from "../features/shared/shell/rail.tsx";
import { themeColors } from "../features/shared/theme.ts";

import styles from "../styles.css?url";

// The document is the route's shell component, so a failure in this route's own read still draws inside a whole document.

const siteFacts = createServerFn({ method: "GET" }).handler(() => ({
  platformUrl: env.PUBLIC_PLATFORM_URL,
}));

// Rendered into the head directly, not through `rootHead`: both metas are named `theme-color`,
// and TanStack's `HeadContent` keeps one meta per name.
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

const TodayCount = () => {
  const hydrated = useHydrated();
  const signedIn = useSignedIn();

  return hydrated && signedIn ? <TodayWaiting /> : null;
};

const Root = () => {
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

export const SITE_DESCRIPTION =
  "A git platform where a project says what it wants as asks, anyone may answer, and a change lands on main only by passing a typed gate, with credit for every person involved.";

const ICON_PATH = "/icons/icon.svg";

// Fonts are fetched without credentials whatever their origin, so the preload says so too,
// or the browser fetches the file twice.
const fontPreload = (href: string) =>
  ({
    as: "font",
    crossOrigin: "anonymous",
    href,
    rel: "preload",
    type: "font/woff2",
  }) as const;

// TanStack keeps one meta per `name` (the last a route gives), so each meta here must have a name of its own.
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
