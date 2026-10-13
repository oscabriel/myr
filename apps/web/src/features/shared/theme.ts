/**
 * The theme (ADR 0042): the system's colour scheme, or its opposite by the
 * reader's choice on `/settings`. The choice lives in `localStorage`, never a
 * cookie: a cookie would mark every request as personal, and the edge cache
 * keeps only requests without one.
 */
import { Option, Result, Schema } from "effect";

/**
 * For the places that cannot read a CSS variable (the `theme-color` meta, the
 * manifest). They equal `--background` in `src/styles.css`.
 */
export const themeColors = {
  dark: "#0a0a0a",
  light: "#f8f7f4",
} as const;

export type Theme = keyof typeof themeColors;

export const ThemePreference = Schema.Literals(["same", "opposite"]);

export type ThemePreference = typeof ThemePreference.Type;

export const THEME_PREFERENCES = ThemePreference.literals;

export const THEME_PREFERENCE_KEY = "theme.preference";

export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export const resolveTheme = (
  system: Theme,
  preference: ThemePreference
): Theme => {
  if (preference === "same") {
    return system;
  }

  return system === "dark" ? "light" : "dark";
};

const decodePreference = Schema.decodeUnknownOption(ThemePreference);

/** Unset, unreadable or a value it never wrote: the same as the system. */
export const readPreference = (storage?: Storage): ThemePreference =>
  Option.getOrElse(
    decodePreference(
      Result.getOrUndefined(
        Result.try(() => storage?.getItem(THEME_PREFERENCE_KEY))
      )
    ),
    (): ThemePreference => "same"
  );

export const writePreference = (
  storage: Storage | undefined,
  preference: ThemePreference
) => {
  Result.try(() => storage?.setItem(THEME_PREFERENCE_KEY, preference));
};

/** As much of a document as the theme writes to. */
export interface ThemeDocument {
  readonly documentElement: { readonly dataset: DOMStringMap };
  readonly querySelectorAll: (
    selector: 'meta[name="theme-color"]'
  ) => Iterable<{
    readonly setAttribute: (name: string, value: string) => void;
  }>;
}

/** What the head script does, for a page that changes the theme once it is up. */
export const applyTheme = (document: ThemeDocument, theme: Theme) => {
  document.documentElement.dataset.theme = theme;

  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", themeColors[theme]);
  }
};

/**
 * The one script the web runs before its own (ADR 0042), inlined in the head
 * by `routes/__root.tsx`. It resolves the theme as `resolveTheme` does, sets
 * `data-theme` on `<html>` before first paint, colours the `theme-color`
 * metas, and does it again when the system's scheme changes or another tab
 * writes the preference. Plain ES5 with no imports; where it never runs, the
 * stylesheet's media query is the fallback. `test/theme.test.ts` runs it.
 */
export const THEME_SCRIPT = `(function(){var d=document,m=matchMedia(${JSON.stringify(DARK_SCHEME_QUERY)}),c=${JSON.stringify(themeColors)};function a(){var p;try{p=localStorage.getItem(${JSON.stringify(THEME_PREFERENCE_KEY)})}catch(e){}var t=m.matches!==(p==="opposite")?"dark":"light";d.documentElement.dataset.theme=t;d.querySelectorAll('meta[name="theme-color"]').forEach(function(n){n.setAttribute("content",c[t])})}a();m.addEventListener("change",a);addEventListener("storage",a)})()`;

/**
 * The script's hash as a CSP source. The web sets no Content-Security-Policy
 * on its pages; one added later lists this in `script-src`. A test holds it
 * to the script's text.
 */
export const THEME_SCRIPT_SOURCE =
  "'sha256-UVuU2lzUb6D/QQew+DGo4QyALam8oODFbOAmm+2stBI='";
