import { useMemo, useSyncExternalStore } from "react";

const subscribe = (query: string) => (changed: () => void) => {
  const list = globalThis.matchMedia(query);

  list.addEventListener("change", changed);

  return () => {
    list.removeEventListener("change", changed);
  };
};

/** False on the server and on the first render, so the markup matches. */
export const useMedia = (query: string): boolean =>
  useSyncExternalStore(
    useMemo(() => subscribe(query), [query]),
    () => globalThis.matchMedia(query).matches,
    () => false
  );

export const COLUMNS_QUERY = "(min-width: 68.75rem)";

export const SPLIT_QUERY = "(min-width: 48rem)";

export const TABLET_QUERY = "(min-width: 40rem)";
