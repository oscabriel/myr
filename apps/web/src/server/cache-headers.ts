/**
 * The `Cache-Control` a page's route gives (its `headers`), by what the
 * page is addressed by. Only a document's own response carries these:
 * the hashed assets get theirs from `public/_headers`.
 *
 * - A page at a full commit id shows what can never change: a browser
 *   keeps it for a year and never asks again.
 * - A page at `main` or a tag changes with the next landing: a browser
 *   keeps it for 30 seconds and may show it for five minutes more while it
 *   asks again. No `s-maxage`: a shared cache that honours it stops serving
 *   stale while it asks.
 * - A page about the person reading it (Today, a decision, a proposal) is
 *   kept nowhere.
 */

export const immutablePage = {
  "Cache-Control": "public, max-age=31536000, immutable",
} as const satisfies Readonly<Record<string, string>>;

export const branchPage = {
  "Cache-Control": "public, max-age=30, stale-while-revalidate=300",
} as const satisfies Readonly<Record<string, string>>;

export const personalPage = {
  "Cache-Control": "private, no-store",
} as const satisfies Readonly<Record<string, string>>;
