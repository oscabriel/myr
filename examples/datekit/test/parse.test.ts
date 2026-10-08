import { describe, expect, test } from "bun:test";

import { isValid, parseISO } from "../src/index.ts";

const iso = (text: string) => parseISO(text).toISOString();

describe("parseISO", () => {
  test("reads a calendar date as the UTC midnight it starts at", () => {
    expect(iso("2026-10-07")).toBe("2026-10-07T00:00:00.000Z");
    expect(iso("20261007")).toBe("2026-10-07T00:00:00.000Z");
  });

  test("reads a year and month as the month's first day, and a year as January 1", () => {
    expect(iso("2026-10")).toBe("2026-10-01T00:00:00.000Z");
    expect(iso("2026")).toBe("2026-01-01T00:00:00.000Z");
  });

  test("reads an ordinal date as the nth day of the year", () => {
    expect(iso("2026-280")).toBe("2026-10-07T00:00:00.000Z");
    expect(iso("2026280")).toBe("2026-10-07T00:00:00.000Z");
    expect(iso("2028-366")).toBe("2028-12-31T00:00:00.000Z");
  });

  test("reads a time with no offset as UTC", () => {
    expect(iso("2026-10-07T14:30")).toBe("2026-10-07T14:30:00.000Z");
    expect(iso("2026-10-07T14")).toBe("2026-10-07T14:00:00.000Z");
    expect(iso("2026-10-07T14:30:15.250")).toBe("2026-10-07T14:30:15.250Z");
  });

  test("takes a UTC offset off the time", () => {
    expect(iso("2026-10-07T09:30:00+09:00")).toBe("2026-10-07T00:30:00.000Z");
    expect(iso("2026-10-07T09:30:00+0900")).toBe("2026-10-07T00:30:00.000Z");
    expect(iso("2026-10-06T20:30:00-03:30")).toBe("2026-10-07T00:00:00.000Z");
    expect(iso("2026-10-07T14:30:00Z")).toBe("2026-10-07T14:30:00.000Z");
    expect(iso("2026-10-07T00:00+05")).toBe("2026-10-06T19:00:00.000Z");
  });

  test("drops digits past the millisecond", () => {
    expect(iso("2026-10-07T14:30:15.123456789Z")).toBe("2026-10-07T14:30:15.123Z");
    expect(iso("2026-10-07T14:30:15,5Z")).toBe("2026-10-07T14:30:15.500Z");
  });

  test("reads February 29 only in a leap year", () => {
    expect(iso("2028-02-29")).toBe("2028-02-29T00:00:00.000Z");
    expect(isValid(parseISO("2026-02-29"))).toBe(false);
    expect(isValid(parseISO("2100-02-29"))).toBe(false);
    expect(iso("2000-02-29")).toBe("2000-02-29T00:00:00.000Z");
  });

  test("reads the years before 100 as written", () => {
    expect(parseISO("0042-03-01").getUTCFullYear()).toBe(42);
  });

  test("gives an invalid date for text it can't read, and never throws", () => {
    for (const text of [
      "",
      "next tuesday",
      "2026-13-01",
      "2026-10-32",
      "2026-00-10",
      "2026-367",
      "2026-10-07T24:00",
      "2026-10-07T14:60",
      "2026-10-07T14:30:00+24:00",
      "2026-10-07T14:30T15:00",
      "26-10-07",
    ]) {
      expect(isValid(parseISO(text)), text).toBe(false);
    }
  });
});

describe("isValid", () => {
  test("tells a real instant from an invalid date", () => {
    expect(isValid(new Date(0))).toBe(true);
    expect(isValid(new Date(Number.NaN))).toBe(false);
  });
});
