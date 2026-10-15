import { describe, expect, it, vi } from "@effect/vitest";
import { DEFAULT_TOKENIZE_MAX_LENGTH, resolveTheme } from "@pierre/diffs";
import { Effect } from "effect";

import {
  CODE_THEME,
  diffsOptions,
  registerCodeTheme,
  treesOptions,
} from "../src/features/code/pierre.ts";

const box = (scrolls: boolean) => ({
  clientHeight: 400,
  clientWidth: 600,
  scrollHeight: 400,
  scrollWidth: scrolls ? 900 : 600,
  tabIndex: -1,
});

describe("the options every drawing of code shares", () => {
  it("name the token theme for both schemes, so the page's scheme decides", () => {
    expect(diffsOptions.theme).toStrictEqual({
      dark: CODE_THEME,
      light: CODE_THEME,
    });
    expect(diffsOptions.themeType).toBe("system");
    expect(diffsOptions.preferredHighlighter).toBe("shiki-js");
  });

  it("carry the library's own limits, written out", () => {
    expect(diffsOptions.tokenizeMaxLength).toBe(100_000);
    expect(diffsOptions.tokenizeMaxLength).toBe(DEFAULT_TOKENIZE_MAX_LENGTH);
    expect(diffsOptions.tokenizeMaxLineLength).toBe(1000);
    expect(diffsOptions.maxLineDiffLength).toBe(1000);
  });

  it("let the keyboard reach code that scrolls, with its focus in sight", () => {
    const wide = box(true);
    const narrow = box(false);

    diffsOptions.onPostRender({
      shadowRoot: { querySelectorAll: () => [wide, narrow] },
    });

    expect([wide.tabIndex, narrow.tabIndex]).toStrictEqual([0, -1]);
    expect(diffsOptions.unsafeCSS).toContain("code:focus-visible");
  });

  it("draw a file tree compact, with plain icons", () => {
    expect(treesOptions).toStrictEqual({
      density: "compact",
      icons: "minimal",
    });
  });
});

describe("the token theme", () => {
  it.effect("colours code from the web's variables", () =>
    Effect.gen(function* () {
      registerCodeTheme();

      const theme = yield* Effect.promise(() => resolveTheme(CODE_THEME));
      const colours = JSON.stringify(theme);

      for (const token of ["keyword", "string", "comment", "constant"]) {
        expect(colours).toContain(`var(--diffs-token-${token}`);
      }

      expect(colours).toContain("var(--diffs-background");
    })
  );

  it("is registered once, however many drawings ask for it", () => {
    const complaints = vi.spyOn(console, "error").mockImplementation(() => {
      // Pierre says so on the console when a theme name is taken twice.
    });

    registerCodeTheme();
    registerCodeTheme();

    expect(complaints).not.toHaveBeenCalled();
    complaints.mockRestore();
  });
});

describe("the drawings of code", () => {
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    "../src/**/*.tsx",
    { eager: true, import: "default", query: "?raw" }
  );

  const drawing = /from\s+["']@pierre\/(?:diffs|trees)\/react["']/u;
  const shared = /from\s+["'](?:\.\.?\/)+(?:code\/)?pierre\.ts["']/u;

  const drawings = Object.entries(sources).filter(([, source]) =>
    drawing.test(source)
  );

  it("each take their options from the one module", () => {
    expect(drawings.length).toBeGreaterThanOrEqual(5);

    expect(
      drawings.flatMap(([path, source]) => (shared.test(source) ? [] : [path]))
    ).toStrictEqual([]);
  });

  it("never fall back to Pierre's own colours", () => {
    expect(
      Object.entries(sources).flatMap(([path, source]) =>
        source.includes("DEFAULT_THEMES") ? [path] : []
      )
    ).toStrictEqual([]);
  });
});
