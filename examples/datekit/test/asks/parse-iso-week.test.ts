import { expect, test } from "bun:test";

import { isValid, parseISO } from "../../src/index.ts";

const day = (text: string) => parseISO(text).getTime();

test("parseISO reads ISO week dates to the UTC midnight of their day", () => {
  // Week 41 of 2026 runs from Monday, October 5 to Sunday, October 11.
  expect(day("2026-W41-3")).toBe(Date.UTC(2026, 9, 7));
  expect(day("2026W413")).toBe(Date.UTC(2026, 9, 7));
  // A week with no day is its Monday.
  expect(day("2026-W41")).toBe(Date.UTC(2026, 9, 5));
  // Week 1 is the week with the year's first Thursday, so it can start in
  // December, and a year that starts on a Thursday has 53 weeks.
  expect(day("2026-W01-1")).toBe(Date.UTC(2025, 11, 29));
  expect(day("2026-W53-7")).toBe(Date.UTC(2027, 0, 3));
  expect(day("2026-W41-3T14:30Z")).toBe(Date.UTC(2026, 9, 7, 14, 30));
  // 2027 starts on a Friday, so it has 52 weeks; and a week has 7 days.
  expect(isValid(parseISO("2027-W53-1"))).toBe(false);
  expect(isValid(parseISO("2026-W41-8"))).toBe(false);
});
