import { Brand } from "@repo/brand";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useLocation,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import type { ReactNode } from "react";

import { TooltipProvider } from "../components/ui/tooltip.tsx";
import { MANIFEST_PATH } from "../features/agents/manifest.ts";
import { SessionSlot } from "../features/auth/session-slot.tsx";
import { SiteFooter, SiteHeader } from "../features/shared/layout.tsx";
import { themeColors } from "../features/shared/theme.ts";

import styles from "../styles.css?url";

// The shell every page shares (issue 511): the document, the header with
// the front page, Today and the session, each page's own <main> (from
// `PageShell`), and the footer's two ways in. Pages read the site's facts
// from this route's loader data (`getRouteApi("__root__").useLoaderData()`).

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
    <body className="flex min-h-dvh flex-col">
      {children}
      <Scripts />
    </body>
  </html>
);

const Root = () => {
  const { platformUrl } = Route.useLoaderData();
  const { pathname } = useLocation();

  return (
    <Document>
      <TooltipProvider>
        <SiteHeader pathname={pathname} session={<SessionSlot />} />
        <Outlet />
        <SiteFooter platformUrl={platformUrl} />
      </TooltipProvider>
    </Document>
  );
};

/** The site's icon, drawn to scale (`public/icons/icon.svg`, issue 505). */
const ICON_PATH = "/icons/icon.svg";

/**
 * The document's head on every page: the stylesheet, the manifest, the icon
 * and the metas. TanStack keeps one meta per `name` (the last a route gives),
 * so each meta here must have a name of its own; the two theme colours are
 * `ThemeColors`, in the document itself.
 */
export const rootHead = () => ({
  links: [
    { href: styles, rel: "stylesheet" },
    // Written from `Brand.name` at each build by `vite.config.ts` (issue 505).
    { href: MANIFEST_PATH, rel: "manifest" },
    { href: ICON_PATH, rel: "icon", type: "image/svg+xml" },
  ],
  meta: [
    { charSet: "utf-8" },
    { content: "width=device-width, initial-scale=1", name: "viewport" },
    { content: "light dark", name: "color-scheme" },
    { title: Brand.name },
  ],
});

export const Route = createRootRoute({
  component: Root,
  head: rootHead,
  loader: () => siteFacts(),
  // The facts are the stage's, fixed for the Worker's life: fetch them once.
  staleTime: Number.POSITIVE_INFINITY,
});
