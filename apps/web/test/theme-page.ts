/**
 * A browser page as far as the theme reaches into one: the root element, the
 * head with two `theme-color` metas per scheme already in it, the system's
 * colour scheme, and a cookie jar that records every write, so a test can say none
 * happened.
 */
import {
  THEME_META,
  THEME_PREFERENCE_KEY,
} from "../src/features/shared/theme.ts";
import type { Theme } from "../src/features/shared/theme.ts";

interface FakeMeta {
  readonly attributes: Map<string, string>;
  readonly setAttribute: (name: string, value: string) => void;
}

const fakeMeta = (entries: readonly (readonly [string, string])[] = []) => {
  const attributes = new Map(entries);

  const meta: FakeMeta = {
    attributes,
    setAttribute: (name, value) => {
      attributes.set(name, value);
    },
  };

  return meta;
};

type StorageListener = (event: { readonly key: string | null }) => void;

const SYSTEM_DARK = "(prefers-color-scheme: dark)";

const rendered = (scheme: Theme, content: string) =>
  fakeMeta([
    ["content", content],
    ["media", `(prefers-color-scheme: ${scheme})`],
    ["name", "theme-color"],
  ]);

export const themePage = (system: Theme) => {
  const root: DOMStringMap = {};

  const head = [
    rendered("light", "react-light"),
    rendered("dark", "react-dark"),
  ];

  const cookies: string[] = [];
  const changes: (() => void)[] = [];
  const stored = new Set<StorageListener>();
  const scheme = { matches: system === "dark" };

  const document = {
    documentElement: { dataset: root },
    get cookie() {
      return cookies.join("; ");
    },
    set cookie(value: string) {
      cookies.push(value);
    },
    head: {
      insertAdjacentHTML: (_: "afterbegin", html: typeof THEME_META) => {
        if (html === THEME_META) {
          head.unshift(
            fakeMeta([
              ["data-theme-color", ""],
              ["name", "theme-color"],
            ])
          );
        }
      },
    },
    querySelector: (selector: string) =>
      selector === "meta[data-theme-color]"
        ? (head.find(({ attributes }) => attributes.has("data-theme-color")) ??
          null)
        : null,
  };

  const matchMedia = (query: string) => ({
    addEventListener: (_: "change", listener: () => void) => {
      changes.push(listener);
    },
    get matches() {
      return query === SYSTEM_DARK && scheme.matches;
    },
  });

  const matching = (meta: FakeMeta) => {
    const media = meta.attributes.get("media");

    return media === undefined || (media === SYSTEM_DARK) === scheme.matches;
  };

  return {
    /** The window's, which hears another tab write to storage. */
    addEventListener: (_: "storage", listener: StorageListener) => {
      stored.add(listener);
    },
    cookies,
    document,
    matchMedia,
    /** Each `theme-color` meta in the head, in order, as its attributes. */
    metas: () => head.map(({ attributes }) => Object.fromEntries(attributes)),
    /** The browser's: the first `theme-color` meta whose media matches. */
    shownColour: () =>
      head
        .find(
          (meta) =>
            meta.attributes.get("name") === "theme-color" && matching(meta)
        )
        ?.attributes.get("content"),
    removeEventListener: (_: "storage", listener: StorageListener) => {
      stored.delete(listener);
    },
    /** Another tab writes to storage, under the theme's key unless named. */
    storageWritten: (key: string | null = THEME_PREFERENCE_KEY) => {
      for (const listener of stored) {
        listener({ key });
      }
    },
    theme: () => root.theme,
    /** The system turns the other way, as at sunset. */
    turnSystem: () => {
      scheme.matches = !scheme.matches;

      for (const changed of changes) {
        changed();
      }
    },
  };
};
