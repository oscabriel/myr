import { expect, it } from "@effect/vitest";

let calls = 0;

it("counts in a test file, outside src/", () => {
  calls += 1;
  expect(calls).toBe(1);
});
