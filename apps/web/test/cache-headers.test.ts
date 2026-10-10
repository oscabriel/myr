/**
 * How long a browser may keep a page, by what the page is addressed by: a
 * page at a full commit id never changes, a page at `main` or a tag changes
 * with the next landing, and a page about the person reading it is theirs
 * alone. A route gives one of these as its `headers`.
 */
import { describe, expect, it } from "@effect/vitest";

import {
  branchPage,
  immutablePage,
  personalPage,
} from "../src/server/cache-headers.ts";

describe("a page's cache headers", () => {
  it("keeps a page at a full commit id for a year, never asking again", () => {
    expect(immutablePage).toStrictEqual({
      "Cache-Control": "public, max-age=31536000, immutable",
    });
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
