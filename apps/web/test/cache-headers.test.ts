/**
 * How long a browser may keep a page, by what the page is addressed by: a
 * page at `main`, a tag or a commit changes with the next landing (a
 * commit's page carries its landing), and a page about the person reading
 * it is theirs alone. A route gives one of these as its `headers`.
 */
import { describe, expect, it } from "@effect/vitest";

import * as CacheHeaders from "../src/server/cache-headers.ts";
import { branchPage, personalPage } from "../src/server/cache-headers.ts";

describe("a page's cache headers", () => {
  it("keeps no page for good: each one carries what a landing may change", () => {
    expect(
      Object.values(CacheHeaders).filter((headers) =>
        headers["Cache-Control"].includes("immutable")
      )
    ).toStrictEqual([]);
  });

  it("keeps a page at main or a tag briefly, and serves it stale while it asks again", () => {
    expect(branchPage).toStrictEqual({
      "Cache-Control": "public, max-age=30, stale-while-revalidate=300",
    });
  });

  it("keeps a page about its reader nowhere", () => {
    expect(personalPage).toStrictEqual({
      "Cache-Control": "private, no-store",
    });
  });
});
