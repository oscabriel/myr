/**
 * Moving a date by whole units. Each function returns a new date and leaves
 * its argument alone. Amounts are whole numbers: a fraction is dropped
 * toward zero (`addDays(date, 1.9)` adds one day). An invalid date stays
 * invalid.
 */
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "./calendar.ts";

const by = (date: Date, amount: number, unit: number): Date =>
  new Date(date.getTime() + Math.trunc(amount) * unit);

export const addMilliseconds = (date: Date, amount: number): Date => by(date, amount, 1);

export const addSeconds = (date: Date, amount: number): Date => by(date, amount, MS_PER_SECOND);

export const addMinutes = (date: Date, amount: number): Date => by(date, amount, MS_PER_MINUTE);

export const addHours = (date: Date, amount: number): Date => by(date, amount, MS_PER_HOUR);

/** Adds days. datekit works in UTC, where every day is 24 hours long. */
export const addDays = (date: Date, amount: number): Date => by(date, amount, MS_PER_DAY);

export const addWeeks = (date: Date, amount: number): Date => addDays(date, Math.trunc(amount) * 7);

/**
 * Adds calendar months, keeping the day of the month and the time of day:
 * October 7 plus three months is January 7.
 */
export const addMonths = (date: Date, amount: number): Date => {
  const next = new Date(date.getTime());

  next.setUTCMonth(next.getUTCMonth() + Math.trunc(amount));

  return next;
};

/** Adds calendar years: twelve months each. */
export const addYears = (date: Date, amount: number): Date =>
  addMonths(date, Math.trunc(amount) * 12);
