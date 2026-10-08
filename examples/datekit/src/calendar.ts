/**
 * The proleptic Gregorian calendar, in UTC: leap years, month lengths, and
 * the instant a calendar day starts. Months are 1 to 12 here, as people
 * write them, not 0 to 11 as `Date` counts them.
 */

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Whether `year` has a February 29. */
export const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** How many days `month` (1 to 12) of `year` has. */
export const daysInMonth = (year: number, month: number): number =>
  month === 2 && isLeapYear(year) ? 29 : (MONTH_LENGTHS[month - 1] ?? Number.NaN);

/** How many days `year` has: 365, or 366 in a leap year. */
export const daysInYear = (year: number): number => (isLeapYear(year) ? 366 : 365);

/**
 * The instant `year-month-day` starts in UTC, in epoch milliseconds.
 * `Date.UTC` reads the years 0 to 99 as 1900 to 1999; this doesn't.
 */
export const utcMidnight = (year: number, month: number, day: number): number => {
  const date = new Date(0);

  date.setUTCFullYear(year, month - 1, day);

  return date.getTime();
};

/** The ISO weekday of an instant in UTC: Monday is 1 and Sunday is 7. */
export const isoWeekday = (date: Date): number => date.getUTCDay() || 7;
