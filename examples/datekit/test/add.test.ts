import { describe, expect, test } from "bun:test";

import {
  addDays,
  addHours,
  addMilliseconds,
  addMinutes,
  addMonths,
  addSeconds,
  addWeeks,
  addYears,
  isValid,
} from "../src/index.ts";

const at = (text: string) => new Date(text);

describe("addDays and addWeeks", () => {
  test("move across a month and a year, keeping the time of day", () => {
    expect(addDays(at("2026-10-07T09:30:00Z"), 1).toISOString()).toBe("2026-10-08T09:30:00.000Z");
    expect(addDays(at("2026-12-31T09:30:00Z"), 1).toISOString()).toBe("2027-01-01T09:30:00.000Z");
    expect(addDays(at("2028-02-28T00:00:00Z"), 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(addDays(at("2026-03-01T00:00:00Z"), -1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addWeeks(at("2026-10-07T00:00:00Z"), 2).toISOString()).toBe("2026-10-21T00:00:00.000Z");
  });

  test("drop a fraction toward zero", () => {
    expect(addDays(at("2026-10-07T00:00:00Z"), 1.9).toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(addDays(at("2026-10-07T00:00:00Z"), -1.9).toISOString()).toBe(
      "2026-10-06T00:00:00.000Z",
    );
  });

  test("leave their argument alone", () => {
    const date = at("2026-10-07T00:00:00Z");

    addDays(date, 3);

    expect(date.toISOString()).toBe("2026-10-07T00:00:00.000Z");
  });
});

describe("addHours, addMinutes, addSeconds and addMilliseconds", () => {
  test("move by exact amounts of time", () => {
    const date = at("2026-10-07T23:30:00Z");

    expect(addHours(date, 1).toISOString()).toBe("2026-10-08T00:30:00.000Z");
    expect(addMinutes(date, -45).toISOString()).toBe("2026-10-07T22:45:00.000Z");
    expect(addSeconds(date, 90).toISOString()).toBe("2026-10-07T23:31:30.000Z");
    expect(addMilliseconds(date, 250).toISOString()).toBe("2026-10-07T23:30:00.250Z");
  });
});

describe("addMonths and addYears", () => {
  test("keep the day of the month when the target month has it", () => {
    expect(addMonths(at("2026-01-15T00:00:00Z"), 1).toISOString()).toBe("2026-02-15T00:00:00.000Z");
    expect(addMonths(at("2026-10-07T08:00:00Z"), 3).toISOString()).toBe("2027-01-07T08:00:00.000Z");
    expect(addMonths(at("2026-03-15T00:00:00Z"), -2).toISOString()).toBe(
      "2026-01-15T00:00:00.000Z",
    );
    expect(addMonths(at("2026-10-07T00:00:00Z"), 0).toISOString()).toBe("2026-10-07T00:00:00.000Z");
  });

  test("add twelve months a year", () => {
    expect(addYears(at("2026-10-07T00:00:00Z"), 2).toISOString()).toBe("2028-10-07T00:00:00.000Z");
    expect(addYears(at("2026-10-07T00:00:00Z"), -26).toISOString()).toBe(
      "2000-10-07T00:00:00.000Z",
    );
  });
});

describe("an invalid date", () => {
  test("stays invalid", () => {
    const invalid = new Date(Number.NaN);

    expect(isValid(addDays(invalid, 1))).toBe(false);
    expect(isValid(addMonths(invalid, 1))).toBe(false);
    expect(isValid(addHours(invalid, 1))).toBe(false);
  });
});
