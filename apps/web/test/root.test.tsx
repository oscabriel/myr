import { describe, expect, it } from "@effect/vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  NotFoundPage,
  PendingPage,
  RouteError,
} from "../src/features/shared/pending.tsx";
import { themeColors } from "../src/features/shared/theme.ts";
import { getRouter } from "../src/router.tsx";
import { rootHead, ThemeColors } from "../src/routes/__root.tsx";

describe("the document's head", () => {
  it("gives each meta a name of its own, since TanStack keeps one per name", () => {
    const names = rootHead().meta.flatMap((meta) =>
      "name" in meta ? [meta.name] : []
    );

    expect(names).toStrictEqual([...new Set(names)]);
  });

  it("carries the light and the dark theme colour, each for its own scheme", () => {
    const markup = renderToStaticMarkup(<ThemeColors />);

    expect(markup).toBe(
      `<meta content="${themeColors.light}" media="(prefers-color-scheme: light)" name="theme-color"/><meta content="${themeColors.dark}" media="(prefers-color-scheme: dark)" name="theme-color"/>`
    );
  });

  it("links the stylesheet, the manifest and the site's icon", () => {
    const { links } = rootHead();

    expect(links).toContainEqual({
      href: "/icons/icon.svg",
      rel: "icon",
      type: "image/svg+xml",
    });
    expect(links).toContainEqual({
      href: "/manifest.webmanifest",
      rel: "manifest",
    });
    expect(
      links
        .filter(({ rel }) => rel === "stylesheet")
        .map(({ href }) => /styles\.css/u.test(href))
    ).toStrictEqual([true]);
  });

  // Found only once the stylesheet is parsed, the fonts arrived late and
  // swapped under text already drawn; preloaded, they start with the page.
  it("preloads the two latin fonts, as fonts fetched without credentials", () => {
    expect(
      rootHead()
        .links.filter(({ rel }) => rel === "preload")
        .map(({ href, ...preload }) => ({
          ...preload,
          file: href.split("/").at(-1),
        }))
    ).toStrictEqual([
      {
        as: "font",
        crossOrigin: "anonymous",
        file: "public-sans-latin.woff2",
        rel: "preload",
        type: "font/woff2",
      },
      {
        as: "font",
        crossOrigin: "anonymous",
        file: "jetbrains-mono-latin.woff2",
        rel: "preload",
        type: "font/woff2",
      },
    ]);
  });
});

describe("the router", () => {
  const { options } = getRouter();

  // A link fetches its page's code and loader data on hover or focus, and
  // a click soon after reads nothing twice.
  it("preloads a link's page on intent, and keeps what it read for a click", () => {
    expect(options.defaultPreload).toBe("intent");
    expect(options.defaultPreloadDelay).toBe(50);
    expect(options.defaultStaleTime).toBeGreaterThan(0);
    expect(options.defaultPreloadStaleTime).toBeGreaterThanOrEqual(
      options.defaultStaleTime ?? 0
    );
  });

  it("waits 300 ms before drawing a page as pending, so a quick move never flashes", () => {
    expect(options.defaultPendingMs).toBe(300);
    expect(options.defaultPendingComponent).toBe(PendingPage);
  });

  it("draws a failure and a missing page in the shell, never the router's own", () => {
    expect(options.defaultErrorComponent).toBe(RouteError);
    expect(options.defaultNotFoundComponent).toBe(NotFoundPage);
  });

  it("scrolls each new page's main pane back to its top", () => {
    expect(options.scrollRestoration).toBeTruthy();
    expect(options.scrollToTopSelectors).toContain("#main");
  });
});
