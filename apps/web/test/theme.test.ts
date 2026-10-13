// ADR 0042: the system's scheme, or its opposite by the reader's choice, kept in localStorage and set before first paint.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  readPreference,
  resolveTheme,
  THEME_PREFERENCE_KEY,
  THEME_SCRIPT,
  THEME_SCRIPT_SOURCE,
  themeColors,
  writePreference,
} from "../src/features/shared/theme.ts";
import type { Theme } from "../src/features/shared/theme.ts";
import { keptStorage, refusingStorage } from "./storage.ts";
import { themePage } from "./theme-page.ts";

describe(resolveTheme, () => {
  it.each([
    ["light", "same", "light"],
    ["light", "opposite", "dark"],
    ["dark", "same", "dark"],
    ["dark", "opposite", "light"],
  ] as const)(
    "resolves a %s system with the %s preference to %s",
    (system, preference, theme) => {
      expect(resolveTheme(system, preference)).toBe(theme);
    }
  );
});

describe(readPreference, () => {
  it("reads an unset preference as the same as the system", () => {
    expect(readPreference(keptStorage())).toBe("same");
    expect(readPreference()).toBe("same");
  });

  it("reads a value it never wrote, or storage the browser refuses, as the same", () => {
    expect(
      readPreference(keptStorage({ [THEME_PREFERENCE_KEY]: "dark" }))
    ).toBe("same");
    expect(readPreference(refusingStorage)).toBe("same");
  });

  it("reads back what was written", () => {
    const storage = keptStorage();

    writePreference(storage, "opposite");

    expect(readPreference(storage)).toBe("opposite");

    writePreference(storage, "same");

    expect(readPreference(storage)).toBe("same");
  });

  it("writes nothing, and throws nothing, where the browser refuses storage", () => {
    expect(() => {
      writePreference(refusingStorage, "opposite");
    }).not.toThrow();
  });
});

/** The head script as the browser runs it: its globals are the page's. */
const runHeadScript = (
  page: ReturnType<typeof themePage>,
  storage: Storage
) => {
  // oxlint-disable-next-line eslint/no-new-func, typescript/no-implied-eval, typescript/no-unsafe-call -- the test runs the inline head script's text as a browser does, with a fake page for its globals; the text is the module's own constant, and no DOM runs in these tests
  new Function(
    "document",
    "localStorage",
    "matchMedia",
    "addEventListener",
    THEME_SCRIPT
  )(page.document, storage, page.matchMedia, page.addEventListener);
};

const storedAs = (stored: string | undefined) =>
  stored === undefined
    ? keptStorage()
    : keptStorage({ [THEME_PREFERENCE_KEY]: stored });

describe("the head script", () => {
  it.each([
    ["light", undefined],
    ["light", "same"],
    ["light", "opposite"],
    ["dark", undefined],
    ["dark", "same"],
    ["dark", "opposite"],
  ] as const)(
    "sets data-theme on a %s system with %s stored as the resolver does",
    (system: Theme, stored) => {
      const page = themePage(system);
      const storage = storedAs(stored);

      runHeadScript(page, storage);

      const theme = resolveTheme(system, readPreference(storage));

      expect(page.theme()).toBe(theme);
      expect(page.shownColour()).toBe(themeColors[theme]);
    }
  );

  // A meta already in the head is left as it is: the script adds one of its
  // own ahead of it, which the browser takes first.
  it("colours the browser's bar with a meta of its own, leaving the head's as they were", () => {
    const page = themePage("light");

    runHeadScript(page, storedAs("opposite"));
    page.turnSystem();

    expect(page.metas()).toStrictEqual([
      {
        content: themeColors.light,
        "data-theme-color": "",
        name: "theme-color",
      },
      {
        content: "react-light",
        media: "(prefers-color-scheme: light)",
        name: "theme-color",
      },
      {
        content: "react-dark",
        media: "(prefers-color-scheme: dark)",
        name: "theme-color",
      },
    ]);
  });

  it("follows the system as it changes", () => {
    const page = themePage("light");

    runHeadScript(page, storedAs("opposite"));

    expect(page.theme()).toBe("dark");

    page.turnSystem();

    expect(page.theme()).toBe("light");
    expect(page.shownColour()).toBe(themeColors.light);
  });

  it("names the system's own scheme whatever the preference, as it turns", () => {
    const page = themePage("light");

    runHeadScript(page, storedAs("opposite"));

    expect(page.system()).toBe("light");

    page.turnSystem();

    expect(page.system()).toBe("dark");
  });

  it("follows a preference another tab writes", () => {
    const page = themePage("light");
    const storage = storedAs("same");

    runHeadScript(page, storage);
    writePreference(storage, "opposite");
    page.storageWritten();

    expect(page.theme()).toBe("dark");
  });

  it("follows the system where the browser refuses storage", () => {
    const page = themePage("dark");

    runHeadScript(page, refusingStorage);

    expect(page.theme()).toBe("dark");
  });

  it("is tiny, imports nothing and never touches a cookie", () => {
    const page = themePage("light");

    runHeadScript(page, storedAs("opposite"));

    expect(new TextEncoder().encode(THEME_SCRIPT).length).toBeLessThan(640);
    expect(THEME_SCRIPT).not.toMatch(/\bimport\b|\brequire\b|cookie/u);
    expect(page.cookies).toStrictEqual([]);
  });
});

// The web sets no Content-Security-Policy on its pages today; one that is
// added must allow the head script by this hash, or the theme never applies.
const encodeBase64 = Schema.encodeEffect(Schema.Uint8ArrayFromBase64);

describe("the head script's CSP source", () => {
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    ["../src/**/*.{ts,tsx}", "../public/_headers"],
    { eager: true, import: "default", query: "?raw" }
  );

  it.effect("is the SHA-256 of the script's text", () =>
    Effect.gen(function* () {
      const digest = yield* Effect.promise(() =>
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(THEME_SCRIPT))
      );

      const hash = yield* encodeBase64(new Uint8Array(digest));

      expect(THEME_SCRIPT_SOURCE).toBe(`'sha256-${hash}'`);
    })
  );

  it("is named wherever the web sets a policy", () => {
    const setting = Object.entries(sources).flatMap(([path, source]) =>
      /content-security-policy/iu.test(source) ? [path] : []
    );

    expect(
      setting.filter(
        (path) => sources[path]?.includes("THEME_SCRIPT_SOURCE") !== true
      )
    ).toStrictEqual([]);
  });
});
