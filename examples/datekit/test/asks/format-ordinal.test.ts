import { expect, test } from "bun:test";

import { format } from "../../src/index.ts";

test("format's Do token prints English ordinals, the teens included", () => {
  const days = [1, 2, 3, 4, 11, 12, 13, 14, 21, 22, 23, 31];

  expect(days.map((day) => format(new Date(Date.UTC(2026, 0, day)), "Do"))).toStrictEqual([
    "1st",
    "2nd",
    "3rd",
    "4th",
    "11th",
    "12th",
    "13th",
    "14th",
    "21st",
    "22nd",
    "23rd",
    "31st",
  ]);
});
