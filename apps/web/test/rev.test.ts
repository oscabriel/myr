import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { revOf, revSegment } from "../src/features/code/rev.ts";

const sha = "0123456789abcdef0123456789abcdef01234567";

const tag = "@changesets/cli@2.27.1";

describe("a revision in a path", () => {
  it.each(["main", sha])("keeps %s as it is", (rev) => {
    expect(revSegment(rev)).toBe(rev);
    expect(revOf(revSegment(rev))).toStrictEqual(Option.some(rev));
  });

  it("puts a scoped tag in one segment, and reads it back", () => {
    const segment = revSegment(tag);

    expect(segment).toBe("%40changesets%2Fcli%402.27.1");
    expect(segment).not.toContain("/");
    expect(revOf(segment)).toStrictEqual(Option.some(tag));
  });

  it("reads a tag a browser left decoded", () => {
    expect(revOf("v1.0.0")).toStrictEqual(Option.some("v1.0.0"));
  });

  it.each(["%", "%E0%A4%A", ""])(
    "names no revision in %j, without throwing",
    (segment) => {
      expect(revOf(segment)).toStrictEqual(Option.none());
    }
  );
});
