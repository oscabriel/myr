import { describe, expect, it } from "@effect/vitest";

import manifest from "../package.json" with { type: "json" };

// A skeleton's one test, so vitest finds a file; real tests replace it.
describe("the package", () => {
  it("is @repo/testkit", () => {
    expect(manifest.name).toBe("@repo/testkit");
  });
});
