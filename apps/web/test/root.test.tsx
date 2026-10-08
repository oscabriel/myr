/**
 * The document every page shares (`routes/__root.tsx`): what its head
 * carries reaches the page whole. TanStack's `HeadContent` keeps one meta per
 * `name`, the last a route gives, so two metas sharing a name lose one
 * silently (512 #6: only the dark `theme-color` reached the page).
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

  it("links the site's icon", () => {
    expect(rootHead().links).toContainEqual({
      href: "/icons/icon.svg",
      rel: "icon",
      type: "image/svg+xml",
    });
  });
});
