/**
 * Whether the screen is at least a width, kept current as the window
 * changes. The server and the page's first render say no, so the markup
 * matches; the browser then says what the screen is.
 */
import { useMemo, useSyncExternalStore } from "react";

const subscribe = (query: string) => (changed: () => void) => {
  const list = globalThis.matchMedia(query);

  list.addEventListener("change", changed);

  return () => {
    list.removeEventListener("change", changed);
  };
};

/** Whether `query` matches now, in the browser; never on the server. */
export const useMedia = (query: string): boolean =>
  useSyncExternalStore(
    useMemo(() => subscribe(query), [query]),
    () => globalThis.matchMedia(query).matches,
    () => false
  );

/** The shell's width, from which the rail holds the tree. */
export const SHELL_QUERY = "(min-width: 70rem)";

/** The width from which a diff may set its sides apart. */
export const SPLIT_QUERY = "(min-width: 48rem)";

/** A tablet's width and wider, where a sheet comes from the side rather than filling the screen. */
export const TABLET_QUERY = "(min-width: 40rem)";
