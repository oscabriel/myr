// No `s-maxage`: a shared cache that honours it stops serving stale while it asks.
// Workers Cache keys by path and query, never by cookie, so a page that gives `branchPage` must read as nobody.

export const branchPage = {
  "Cache-Control": "public, max-age=30, stale-while-revalidate=300",
} as const satisfies Readonly<Record<string, string>>;

export const personalPage = {
  "Cache-Control": "private, no-store",
} as const satisfies Readonly<Record<string, string>>;
