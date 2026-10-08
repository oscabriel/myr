import { describe, expect, test } from "bun:test";

import { format, isTimeZone, offsetIn } from "../src/index.ts";

// Wednesday, October 7, 2026, 14:05:09.250 UTC.
const afternoon = new Date(Date.UTC(2026, 9, 7, 14, 5, 9, 250));

const on = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour, minute));

describe("format", () => {
  test("shows the year, month and day by their tokens", () => {
    expect(format(afternoon, "yyyy-MM-dd")).toBe("2026-10-07");
    expect(format(afternoon, "d MMMM yyyy")).toBe("7 October 2026");
    expect(format(afternoon, "EEE, d MMM yy")).toBe("Wed, 7 Oct 26");
    expect(format(afternoon, "EEEE M/d")).toBe("Wednesday 10/7");
  });

  test("shows the time on a 24-hour and a 12-hour clock", () => {
    expect(format(afternoon, "HH:mm:ss.SSS")).toBe("14:05:09.250");
    expect(format(afternoon, "h:mm a")).toBe("2:05 PM");
    expect(format(on(2026, 10, 7, 0, 5), "hh:mm a")).toBe("12:05 AM");
    expect(format(on(2026, 10, 7, 12), "h a")).toBe("12 PM");
    expect(format(on(2026, 10, 7, 9), "H")).toBe("9");
  });

  test("shows the day of the month as an English ordinal", () => {
    const days = [1, 2, 3, 4, 10, 20, 21, 22, 23, 24, 30, 31];

    expect(days.map((day) => format(on(2026, 1, day), "Do"))).toStrictEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "10th",
      "20th",
      "21st",
      "22nd",
      "23rd",
      "24th",
      "30th",
      "31st",
    ]);
  });

  test("prints quoted text as it is, and '' as one quote", () => {
    expect(format(afternoon, "'Week of' MMMM d")).toBe("Week of October 7");
    expect(format(afternoon, "h 'o''clock'")).toBe("2 o'clock");
    expect(format(afternoon, "yyyy''MM")).toBe("2026'10");
    expect(format(afternoon, "'at' HH:mm 'sharp")).toBe("at 14:05 sharp");
  });

  test("passes punctuation and spaces through", () => {
    expect(format(afternoon, "[yyyy] (MM) / dd.")).toBe("[2026] (10) / 07.");
  });

  test("refuses a letter that is no token, an invalid date and an unknown zone", () => {
    expect(() => format(afternoon, "yyyy-MM-dd at HH")).toThrow(RangeError);
    expect(() => format(afternoon, "yyy")).toThrow(RangeError);
    expect(() => format(new Date(Number.NaN), "yyyy")).toThrow(RangeError);
    expect(() => format(afternoon, "HH", { timeZone: "Mars/Olympus_Mons" })).toThrow(RangeError);
  });

  test("shows UTC's offset as Z", () => {
    expect(format(afternoon, "yyyy-MM-dd'T'HH:mm:ssXXX")).toBe("2026-10-07T14:05:09Z");
  });
});

describe("format in a time zone", () => {
  test("shows the wall clock of the zone, with its offset", () => {
    const zoned = (timeZone: string) => format(afternoon, "yyyy-MM-dd HH:mm XXX EEE", { timeZone });

    expect(zoned("Asia/Tokyo")).toBe("2026-10-07 23:05 +09:00 Wed");
    expect(zoned("Asia/Kolkata")).toBe("2026-10-07 19:35 +05:30 Wed");
    expect(zoned("America/Sao_Paulo")).toBe("2026-10-07 11:05 -03:00 Wed");
    expect(zoned("Pacific/Kiritimati")).toBe("2026-10-08 04:05 +14:00 Thu");
    expect(zoned("UTC")).toBe("2026-10-07 14:05 Z Wed");
  });

  test("follows daylight saving time", () => {
    expect(format(on(2026, 7, 1, 12), "HH:mm XXX", { timeZone: "America/New_York" })).toBe(
      "08:00 -04:00",
    );
    expect(format(on(2026, 1, 15, 12), "HH:mm XXX", { timeZone: "America/New_York" })).toBe(
      "07:00 -05:00",
    );
    expect(offsetIn(on(2026, 7, 1), "Europe/Lisbon")).toBe(60);
    expect(offsetIn(on(2026, 12, 1), "Europe/Lisbon")).toBe(0);
  });

  test("knows the zones the runtime knows", () => {
    expect(isTimeZone("Europe/Lisbon")).toBe(true);
    expect(isTimeZone("Mars/Olympus_Mons")).toBe(false);
  });
});
