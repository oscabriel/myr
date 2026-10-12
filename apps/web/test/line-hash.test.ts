import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import {
  diffLinesHash,
  lineHash,
  parseDiffHash,
  parseLineHash,
} from "../src/features/code/line-hash.ts";

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

describe("a file in a commit's diff, by its anchor", () => {
  it("names the file, its path decoded", () => {
    expect(parseDiffHash("#diff-src%2Fparse.ts")).toStrictEqual(
      Option.some({ lines: Option.none(), path: "src/parse.ts" })
    );
  });

  it("names lines on the new side, or the old with D", () => {
    expect(parseDiffHash("diff-src%2Fparse.ts:L4-L7")).toStrictEqual(
      Option.some({
        lines: Option.some({
          end: 7,
          path: "src/parse.ts",
          side: "additions",
          start: 4,
        }),
        path: "src/parse.ts",
      })
    );
    expect(
      Option.flatMap(parseDiffHash("#diff-a.ts:D3"), ({ lines }) => lines)
    ).toStrictEqual(
      Option.some({ end: 3, path: "a.ts", side: "deletions", start: 3 })
    );
  });

  it("is written back as it is read", () => {
    const lines = {
      end: 9,
      path: "src/a b.ts",
      side: "additions",
      start: 2,
    } as const;

    expect(
      Option.flatMap(
        parseDiffHash(diffLinesHash(lines)),
        (named) => named.lines
      )
    ).toStrictEqual(Option.some(lines));
  });

  it("names nothing for another anchor", () => {
    expect(parseDiffHash("#L4")).toStrictEqual(Option.none());
  });
});
