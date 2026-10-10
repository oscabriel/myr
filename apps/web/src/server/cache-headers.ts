/**
 * The `Cache-Control` a page's route gives (its `headers`), by what the
 * page is addressed by. Only a document's own response carries these:
 * the hashed assets get theirs from `public/_headers`.
 *
 * - A page at `main` or a tag changes with the next landing: a browser
 *   keeps it for 30 seconds and may show it for five minutes more while it
 *   asks again. No `s-maxage`: a shared cache that honours it stops serving
 *   stale while it asks. A code page at a full commit id is kept the same
 *   way: the commit never changes, but the page also carries its landing,
 *   which the project records after main has moved (a read between the two
 *   finds none), and times reckoned from when it was read. What does not
 *   change is kept below the page, by object id (ADR 0019, ADR 0020).
 * - A page about the person reading it (Today, a decision, a proposal) is
 *   kept nowhere.
 *
 * Workers Cache keeps these at the edge too, shared by every reader, keyed
 * by path and query and never by cookie (ADR 0026). So a page that gives
 * `branchPage` reads as nobody: its loader never reaches the reader's
 * request, and its markup is the same for everyone. The Worker's entry
 * (`edge-cache.ts`) has the last word on every answer: one to a request
 * that carries a cookie is kept nowhere whatever its route says, and one
 * the edge may keep varies by `Cookie`, so it reaches only a reader with
 * none (`test/edge-cache.test.ts`).
 */

export const branchPage = {
  "Cache-Control": "public, max-age=30, stale-while-revalidate=300",
} as const satisfies Readonly<Record<string, string>>;

export const personalPage = {
  "Cache-Control": "private, no-store",
} as const satisfies Readonly<Record<string, string>>;
