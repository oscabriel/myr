/**
 * A browser page as far as the theme reaches into one: the root element, the
 * two `theme-color` metas, the system's colour scheme, and a cookie jar that
 * records every write, so a test can say none happened.
 */
import type { Theme } from "../src/features/shared/theme.ts";

interface FakeMeta {
  readonly attributes: Map<string, string>;
  readonly setAttribute: (name: string, value: string) => void;
}

const fakeMeta = (media: string): FakeMeta => {
  const attributes = new Map([
    ["media", media],
    ["name", "theme-color"],
  ]);

  return {
    attributes,
    setAttribute: (name, value) => {
      attributes.set(name, value);
    },
  };
};

export const themePage = (system: Theme) => {
  const root: DOMStringMap = {};

  const metas = [
    fakeMeta("(prefers-color-scheme: light)"),
    fakeMeta("(prefers-color-scheme: dark)"),
  ];

  const cookies: string[] = [];
  const changes: (() => void)[] = [];
  const stored: (() => void)[] = [];
  const scheme = { matches: system === "dark" };

  const document = {
    documentElement: { dataset: root },
    get cookie() {
      return cookies.join("; ");
    },
    set cookie(value: string) {
      cookies.push(value);
    },
    querySelectorAll: (selector: string) =>
      selector === 'meta[name="theme-color"]' ? metas : [],
  };

  const matchMedia = (query: string) => ({
    addEventListener: (_: "change", listener: () => void) => {
      changes.push(listener);
    },
    get matches() {
      return query === "(prefers-color-scheme: dark)" && scheme.matches;
    },
  });

  return {
    /** The window's, which hears another tab write to storage. */
    addEventListener: (_: "storage", listener: () => void) => {
      stored.push(listener);
    },
    cookies,
    document,
    matchMedia,
    /** The colour each `theme-color` meta now carries. */
    metaColours: () => metas.map(({ attributes }) => attributes.get("content")),
    /** The system turns the other way, as at sunset. */
    turnSystem: () => {
      scheme.matches = !scheme.matches;

      for (const changed of changes) {
        changed();
      }
    },
    /** Another tab writes to storage. */
    storageWritten: () => {
      for (const listener of stored) {
        listener();
      }
    },
    theme: () => root.theme,
  };
};
