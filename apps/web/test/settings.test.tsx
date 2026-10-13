// ADR 0042: /settings → Appearance, "Same as system" or "Opposite of system", each shown as what it resolves to now.
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  AppearanceView,
  choosePreference,
} from "../src/features/settings/appearance.tsx";
import { SettingsView } from "../src/features/settings/settings-page.tsx";
import {
  readPreference,
  THEME_PREFERENCE_KEY,
} from "../src/features/shared/theme.ts";
import type { Theme, ThemePreference } from "../src/features/shared/theme.ts";
import { attributeOf, textIn } from "./markup.ts";
import { renderAt } from "./render.tsx";
import { keptStorage } from "./storage.ts";
import { themePage } from "./theme-page.ts";

const ignore = () => {};

/** Each choice as its label reads, and the radio it holds. */
const choicesIn = (markup: string) =>
  [...markup.matchAll(/<label\b[^>]*>(?<body>[^]*?)<\/label>/gu)].map(
    ({ groups }) => {
      const body = groups?.body ?? "";
      const radio = /<input\b[^>]*type="radio"[^>]*>/u.exec(body)?.[0] ?? "";

      return {
        checked: / checked=""/u.test(radio),
        text: textIn(body),
        value: attributeOf(radio, "value"),
      };
    }
  );

const appearanceAt = (system: Theme | undefined, preference: ThemePreference) =>
  renderAt(
    "/settings",
    <AppearanceView onChoose={ignore} preference={preference} system={system} />
  );

describe(AppearanceView, () => {
  it.effect(
    "shows both choices, each with the theme it gives on a light system",
    () =>
      Effect.gen(function* () {
        const choices = choicesIn(yield* appearanceAt("light", "same"));

        expect(choices).toStrictEqual([
          { checked: true, text: "Same as systemLight", value: "same" },
          { checked: false, text: "Opposite of systemDark", value: "opposite" },
        ]);
      })
  );

  it.effect("turns each choice's theme round on a dark system", () =>
    Effect.gen(function* () {
      const choices = choicesIn(yield* appearanceAt("dark", "opposite"));

      expect(choices).toStrictEqual([
        { checked: false, text: "Same as systemDark", value: "same" },
        { checked: true, text: "Opposite of systemLight", value: "opposite" },
      ]);
    })
  );

  // The server cannot see the reader's system, so it names no theme it
  // would have to take back.
  it.effect("names no theme until the system is known", () =>
    Effect.gen(function* () {
      const choices = choicesIn(yield* appearanceAt(undefined, "same"));

      expect(choices.map(({ text }) => text)).toStrictEqual([
        "Same as system",
        "Opposite of system",
      ]);
    })
  );
});

describe(SettingsView, () => {
  it.effect(
    "is the settings page, with Appearance and the same as the system checked while nothing is stored",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt("/settings", <SettingsView />);

        expect(textIn(markup)).toContain("Settings");
        expect(textIn(markup)).toContain("Appearance");
        expect(
          choicesIn(markup).flatMap(({ checked, value }) =>
            checked ? [value] : []
          )
        ).toStrictEqual(["same"]);
      })
  );
});

describe(choosePreference, () => {
  it("writes the choice to localStorage and applies it, writing no cookie", () => {
    const page = themePage("light");
    const storage = keptStorage();

    choosePreference("opposite", {
      document: page.document,
      storage,
      system: "light",
    });

    expect(storage.getItem(THEME_PREFERENCE_KEY)).toBe("opposite");
    expect(readPreference(storage)).toBe("opposite");
    expect(page.theme()).toBe("dark");
    expect(page.cookies).toStrictEqual([]);
  });

  it("goes back to the system's theme", () => {
    const page = themePage("dark");
    const storage = keptStorage({ [THEME_PREFERENCE_KEY]: "opposite" });

    choosePreference("same", {
      document: page.document,
      storage,
      system: "dark",
    });

    expect(readPreference(storage)).toBe("same");
    expect(page.theme()).toBe("dark");
    expect(page.cookies).toStrictEqual([]);
  });
});

describe("the preference's code", () => {
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    [
      "../src/features/settings/**/*.{ts,tsx}",
      "../src/features/shared/theme.ts",
      "../src/routes/settings.tsx",
    ],
    { eager: true, import: "default", query: "?raw" }
  );

  // A cookie would mark every request as personal, out of the edge cache.
  it("never reaches for a cookie", () => {
    const uncommented = Object.entries(sources).map(([path, source]) => [
      path,
      source.replaceAll(/\/\*[^]*?\*\/|\/\/.*$/gmu, ""),
    ]);

    expect(uncommented.length).toBeGreaterThanOrEqual(4);
    expect(
      uncommented.flatMap(([path, source]) =>
        /cookie/iu.test(source ?? "") ? [path] : []
      )
    ).toStrictEqual([]);
  });
});
