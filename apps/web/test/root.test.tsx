/**
 * The document every page shares (`routes/__root.tsx`): what its head
 * carries reaches the page whole. TanStack's `HeadContent` keeps one meta per
 * `name`, the last a route gives, so two metas sharing a name lose one
 * silently (once, only the dark `theme-color` reached the page).
 */
import { describe, expect, it } from "@effect/vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { themeColors } from "../src/features/shared/theme.ts";
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
