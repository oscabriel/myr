import { describe, expect, it } from "@effect/vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  NotFoundPage,
  PendingPage,
  RouteError,
} from "../src/features/shared/pending.tsx";
import {
  THEME_SCRIPT,
  themeColors,
} from "../src/features/shared/theme.ts";
import { getRouter } from "../src/router.tsx";
import { rootHead, ThemeHead } from "../src/routes/__root.tsx";

// The source as text: what the root imports, read without running it.
const [rootSource = ""] = Object.values(
  import.meta.glob<string>("../src/routes/__root.tsx", {
    eager: true,
    import: "default",
    query: "?raw",
  })
);

describe("the document's head", () => {
  it("gives each meta a name of its own, since TanStack keeps one per name", () => {
    const names = rootHead().meta.flatMap((meta) =>
      "name" in meta ? [meta.name] : []
    );

    expect(names).toStrictEqual([...new Set(names)]);
  });

  // ADR 0042: the metas name each scheme's paper for a page whose script
  // never runs; the script then colours both for the resolved theme.
  it("carries each scheme's theme colour, then the theme script, verbatim", () => {
    const markup = renderToStaticMarkup(<ThemeHead />);

    expect(markup).toBe(
      `<meta content="${themeColors.light}" media="(prefers-color-scheme: light)" name="theme-color"/><meta content="${themeColors.dark}" media="(prefers-color-scheme: dark)" name="theme-color"/><script>${THEME_SCRIPT}</script>`
    );
  });

  // The script writes `data-theme` and the metas' colour before React
  // hydrates, so those elements accept what they find.
  it("puts the theme in the document's head, and lets hydration find it changed", () => {
    expect(rootSource).toMatch(
      /<html lang="en" suppressHydrationWarning>\s*<head>[^]*<ThemeHead \/>[^]*<\/head>/u
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
        file: "ibm-plex-sans-latin-wght-normal.woff2",
        rel: "preload",
        type: "font/woff2",
      },
      {
        as: "font",
        crossOrigin: "anonymous",
        file: "ibm-plex-mono-latin-400-normal.woff2",
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

describe("the root's reads", () => {
  // The rail's Today count loaded with every page; the account's inbox count
  // is fetched, with its read, only once a signed-in reader's page is up.
  it("reach the inbox's count only through a lazy import", () => {
    expect(rootSource).not.toMatch(/^import\b[^;]*client\/today/mu);
    expect(rootSource).toContain(
      'lazy(() => import("../features/account/inbox-count.tsx"))'
    );
  });

  it("read the project list only in the reader the search mounts", () => {
    expect(rootSource).not.toContain("projectsAtom");
    expect(rootSource).toMatch(
      /const ReadProjects[^=]*= \(\{ children \}\) =>\s*children\(useProjectList\(\)\)/u
    );
  });
});
