/**
 * A line anchor, as a file page's address carries it: `#L10` names one
 * line and `#L10-L20` a range, whichever end comes first. Anything else
 * names no line. One pure parser, read by the file, why and propose pages.
 */
import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { lineHash, parseLineHash } from "../src/features/code/line-hash.ts";

describe("a line anchor", () => {
  it("names one line", () => {
    expect(parseLineHash("#L10")).toStrictEqual(
      Option.some({ end: 10, start: 10 })
    );
  });

  it("names a range", () => {
    expect(parseLineHash("#L10-L20")).toStrictEqual(
      Option.some({ end: 20, start: 10 })
    );
  });

  it("names the same range whichever end comes first", () => {
    expect(parseLineHash("#L20-L10")).toStrictEqual(
      Option.some({ end: 20, start: 10 })
    );
  });

  it("reads the router's hash, which carries no #", () => {
    expect(parseLineHash("L7")).toStrictEqual(
      Option.some({ end: 7, start: 7 })
    );
  });

  it.each(["#L0", "#Lx", "#foo", "", "#L", "#L1-", "#L1-L0", "#L01", "#L3-7"])(
    "names no line in %j",
    (hash) => {
      expect(parseLineHash(hash)).toStrictEqual(Option.none());
    }
  );

  it("is written back as #L<a>-L<b>, or #L<n> for one line", () => {
    expect(lineHash({ end: 20, start: 10 })).toBe("#L10-L20");
    expect(lineHash({ end: 7, start: 7 })).toBe("#L7");
  });

  it("round-trips through its own writing", () => {
    expect(parseLineHash(lineHash({ end: 42, start: 3 }))).toStrictEqual(
      Option.some({ end: 42, start: 3 })
    );
  });
});
