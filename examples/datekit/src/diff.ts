/**
 * How far apart two dates are. Each function takes the later date first and
 * counts whole units, dropping a part unit toward zero, so the answer is
 * negative when the first date is the earlier one. An invalid date gives
 * `NaN`.
 */
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND, utcMidnight } from "./calendar.ts";

// `+ 0` turns the `-0` that `Math.trunc(-0.5)` gives into `0`.
const wholeUnits = (later: Date, earlier: Date, unit: number): number =>
  Math.trunc((later.getTime() - earlier.getTime()) / unit) + 0;

export const diffInMilliseconds = (later: Date, earlier: Date): number =>
  later.getTime() - earlier.getTime();

export const diffInSeconds = (later: Date, earlier: Date): number =>
  wholeUnits(later, earlier, MS_PER_SECOND);

export const diffInMinutes = (later: Date, earlier: Date): number =>
  wholeUnits(later, earlier, MS_PER_MINUTE);

export const diffInHours = (later: Date, earlier: Date): number =>
  wholeUnits(later, earlier, MS_PER_HOUR);

/**
 * Whole 24-hour days between two instants: from 12:00 one day to 11:00 the
 * next is 0 days. To count the midnights crossed, use `diffInCalendarDays`.
 */
export const diffInDays = (later: Date, earlier: Date): number =>
  wholeUnits(later, earlier, MS_PER_DAY);

export const diffInWeeks = (later: Date, earlier: Date): number =>
  wholeUnits(later, earlier, 7 * MS_PER_DAY);

const startOfUtcDay = (date: Date) =>
  utcMidnight(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());

/** The UTC midnights between two dates: from 23:59 one day to 00:00 the next is 1. */
export const diffInCalendarDays = (later: Date, earlier: Date): number =>
  Math.round((startOfUtcDay(later) - startOfUtcDay(earlier)) / MS_PER_DAY) + 0;

/** The month boundaries between two dates: from October 31 to January 1 is 3. */
export const diffInCalendarMonths = (later: Date, earlier: Date): number =>
  (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 +
  (later.getUTCMonth() - earlier.getUTCMonth());
