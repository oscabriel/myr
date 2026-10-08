import { describe, expect, test } from "bun:test";

import {
  daysInMonth,
  diffInCalendarDays,
  diffInCalendarMonths,
  diffInDays,
  diffInHours,
  diffInMilliseconds,
  diffInMinutes,
  diffInSeconds,
  diffInWeeks,
  isLeapYear,
} from "../src/index.ts";

const at = (text: string) => new Date(text);

describe("diffInDays", () => {
  test("counts whole 24-hour days, toward zero", () => {
    expect(diffInDays(at("2026-10-08T00:00:00Z"), at("2026-10-07T12:00:00Z"))).toBe(0);
    expect(diffInDays(at("2026-10-09T01:00:00Z"), at("2026-10-07T00:00:00Z"))).toBe(2);
    expect(diffInDays(at("2026-10-07T00:00:00Z"), at("2026-10-09T01:00:00Z"))).toBe(-2);
    expect(diffInDays(at("2026-10-07T00:00:00Z"), at("2026-10-07T12:00:00Z"))).toBe(0);
  });

  test("counts February 29 in a leap year", () => {
    expect(diffInDays(at("2028-03-01T00:00:00Z"), at("2028-02-01T00:00:00Z"))).toBe(29);
    expect(diffInDays(at("2026-03-01T00:00:00Z"), at("2026-02-01T00:00:00Z"))).toBe(28);
  });

  test("gives NaN for an invalid date", () => {
    expect(diffInDays(new Date(Number.NaN), at("2026-10-07T00:00:00Z"))).toBeNaN();
  });
});

describe("diffInCalendarDays", () => {
  test("counts the UTC midnights crossed", () => {
    expect(diffInCalendarDays(at("2026-10-08T00:00:00Z"), at("2026-10-07T23:59:00Z"))).toBe(1);
    expect(diffInCalendarDays(at("2026-10-07T23:59:00Z"), at("2026-10-07T00:00:00Z"))).toBe(0);
    expect(diffInCalendarDays(at("2027-01-01T00:00:00Z"), at("2026-01-01T00:00:00Z"))).toBe(365);
  });
});

describe("diffInCalendarMonths", () => {
  test("counts the month boundaries crossed", () => {
    expect(diffInCalendarMonths(at("2027-01-01T00:00:00Z"), at("2026-10-31T00:00:00Z"))).toBe(3);
    expect(diffInCalendarMonths(at("2026-10-31T00:00:00Z"), at("2026-10-01T00:00:00Z"))).toBe(0);
    expect(diffInCalendarMonths(at("2026-01-01T00:00:00Z"), at("2026-10-31T00:00:00Z"))).toBe(-9);
  });
});

describe("the smaller units", () => {
  test("count whole hours, minutes, seconds and weeks", () => {
    const start = at("2026-10-07T00:00:00Z");
    const later = at("2026-10-21T01:30:45.500Z");

    expect(diffInMilliseconds(later, start)).toBe(1_215_045_500);
    expect(diffInSeconds(later, start)).toBe(1_215_045);
    expect(diffInMinutes(later, start)).toBe(20_250);
    expect(diffInHours(later, start)).toBe(337);
    expect(diffInWeeks(later, start)).toBe(2);
  });
});

describe("the calendar", () => {
  test("knows the leap years and the length of each month", () => {
    expect([1900, 2000, 2026, 2028].map(isLeapYear)).toStrictEqual([false, true, false, true]);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});
