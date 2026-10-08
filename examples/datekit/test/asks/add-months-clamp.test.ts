import { expect, test } from "bun:test";

import { addMonths, addYears } from "../../src/index.ts";

const plusMonths = (text: string, amount: number) =>
  addMonths(new Date(text), amount).toISOString();

test("addMonths ends on the last day of a target month too short for the day", () => {
  // January 31 plus a month is the end of February, in leap and common years.
  expect(plusMonths("2028-01-31T00:00:00Z", 1)).toBe("2028-02-29T00:00:00.000Z");
  expect(plusMonths("2026-01-31T00:00:00Z", 1)).toBe("2026-02-28T00:00:00.000Z");
  // The time of day stays, and so does the direction.
  expect(plusMonths("2026-10-31T09:30:00Z", 1)).toBe("2026-11-30T09:30:00.000Z");
  expect(plusMonths("2026-03-31T00:00:00Z", -1)).toBe("2026-02-28T00:00:00.000Z");
  expect(plusMonths("2026-05-31T00:00:00Z", -11)).toBe("2025-06-30T00:00:00.000Z");
  // A year is twelve months, so February 29 plus a year is February 28.
  expect(addYears(new Date("2028-02-29T00:00:00Z"), 1).toISOString()).toBe(
    "2029-02-28T00:00:00.000Z",
  );
});
