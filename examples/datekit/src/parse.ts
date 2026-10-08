/**
 * Reading ISO 8601 text. `parseISO` reads calendar dates and ordinal dates,
 * with an optional time and UTC offset, and never throws: text it can't read
 * gives an invalid date, which `isValid` tells apart.
 */
import {
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  daysInMonth,
  daysInYear,
  utcMidnight,
} from "./calendar.ts";

/** A date that stands for no instant: what `parseISO` gives for text it can't read. */
export const invalidDate = (): Date => new Date(Number.NaN);

/** Whether `date` stands for an instant (an invalid date doesn't). */
export const isValid = (date: Date): boolean => !Number.isNaN(date.getTime());

/** The date forms `parseISO` reads, extended and basic. */
const CALENDAR_DATES = [
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u,
  /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})$/u,
  /^(?<year>\d{4})-(?<month>\d{2})$/u,
  /^(?<year>\d{4})$/u,
];

const ORDINAL_DATE = /^(?<year>\d{4})-?(?<ordinal>\d{3})$/u;

const TIME =
  /^(?<hour>\d{2})(?::(?<minute>\d{2})(?::(?<second>\d{2})(?:[.,](?<fraction>\d{1,9}))?)?)?(?<offset>Z|[+-]\d{2}(?::?\d{2})?)?$/u;

const OFFSET = /^(?<sign>[+-])(?<hours>\d{2}):?(?<minutes>\d{2})?$/u;

const whole = (digits: string | undefined, fallback = 0): number =>
  digits === undefined ? fallback : Number(digits);

/** A calendar date, as the instant it starts in UTC; `undefined` when it isn't a real day. */
const calendarDay = (year: number, month: number, day: number): number | undefined =>
  month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
    ? utcMidnight(year, month, day)
    : undefined;

/** The start of the day the date part names, in epoch milliseconds. */
const readDate = (text: string): number | undefined => {
  for (const form of CALENDAR_DATES) {
    const groups = form.exec(text)?.groups;

    if (groups !== undefined) {
      return calendarDay(whole(groups.year), whole(groups.month, 1), whole(groups.day, 1));
    }
  }

  const ordinal = ORDINAL_DATE.exec(text)?.groups;

  if (ordinal !== undefined) {
    const year = whole(ordinal.year);
    const day = whole(ordinal.ordinal);

    return day >= 1 && day <= daysInYear(year) ? utcMidnight(year, 1, day) : undefined;
  }

  return undefined;
};

/** A UTC offset (`Z`, `+09:00`, `-0330`, `+05`) in minutes east of UTC. */
const readOffset = (text: string | undefined): number | undefined => {
  if (text === undefined || text === "Z") {
    return 0;
  }

  const groups = OFFSET.exec(text)?.groups;

  if (groups === undefined) {
    return undefined;
  }

  const hours = whole(groups.hours);
  const minutes = whole(groups.minutes);

  if (hours > 23 || minutes > 59) {
    return undefined;
  }

  return (groups.sign === "-" ? -1 : 1) * (hours * 60 + minutes);
};

/** How far past midnight the time part is, in UTC milliseconds (its offset taken off). */
const readTime = (text: string): number | undefined => {
  const groups = TIME.exec(text)?.groups;

  if (groups === undefined) {
    return undefined;
  }

  const hour = whole(groups.hour);
  const minute = whole(groups.minute);
  const second = whole(groups.second);
  const offset = readOffset(groups.offset);

  if (hour > 23 || minute > 59 || second > 59 || offset === undefined) {
    return undefined;
  }

  // Digits past the millisecond are dropped, not rounded.
  const millisecond = whole((groups.fraction ?? "").padEnd(3, "0").slice(0, 3));

  return (
    hour * MS_PER_HOUR +
    minute * MS_PER_MINUTE +
    second * MS_PER_SECOND +
    millisecond -
    offset * MS_PER_MINUTE
  );
};

/**
 * Reads ISO 8601 text: a date (`2026-10-07`, `20261007`, `2026-10`, `2026`,
 * or the ordinal `2026-280`), then optionally `T` and a time (`14:30`,
 * `14:30:15`, `14:30:15.250`) with a UTC offset (`Z`, `+09:00`). Text with
 * no offset is read as UTC. Anything else, or a day that doesn't exist
 * (`2026-02-29`), gives an invalid date.
 */
export const parseISO = (text: string): Date => {
  const [datePart = "", timePart, ...rest] = text.trim().split("T");
  const day = readDate(datePart);

  if (day === undefined || rest.length > 0) {
    return invalidDate();
  }

  if (timePart === undefined) {
    return new Date(day);
  }

  const time = readTime(timePart);

  return time === undefined ? invalidDate() : new Date(day + time);
};
