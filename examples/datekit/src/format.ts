/**
 * Showing a date as text with a pattern: `format(date, "d MMMM yyyy")` is
 * `7 October 2026`. Letters are tokens; text in single quotes is printed as
 * it is (`''` prints one quote); any other character passes through. A
 * letter that is no token is refused, so a typo never prints a wrong date.
 */
import { isValid } from "./parse.ts";
import { utcParts, zonedParts } from "./tz.ts";
import type { ZonedParts } from "./tz.ts";

/** How `format` shows a date. */
export interface FormatOptions {
  /** The IANA zone to show the date in (`America/New_York`); UTC when left out. */
  readonly timeZone?: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const pad = (value: number, width: number) => String(value).padStart(width, "0");

// The English suffix by last digit: 1st, 2nd, 3rd, and th for the rest.
const SUFFIXES = ["th", "st", "nd", "rd"];

/** A number as an English ordinal: `1st`, `2nd`, `3rd`, `4th`. */
export const ordinal = (value: number): string => `${value}${SUFFIXES[value % 10] ?? "th"}`;

/** A UTC offset as `Z`, or `+09:00`, `-04:00`, `+05:30`. */
const offsetText = (minutes: number) => {
  if (minutes === 0) {
    return "Z";
  }

  const sign = minutes < 0 ? "-" : "+";
  const size = Math.abs(minutes);

  return `${sign}${pad(Math.floor(size / 60), 2)}:${pad(size % 60, 2)}`;
};

const twelveHour = (hour: number) => hour % 12 || 12;

/** Each token, and how it shows a date's fields. */
const TOKENS: Readonly<Record<string, (parts: ZonedParts) => string>> = {
  // Year
  yyyy: ({ year }) => pad(year, 4),
  yy: ({ year }) => pad(year % 100, 2),
  // Month
  MMMM: ({ month }) => MONTHS[month - 1] ?? "",
  MMM: ({ month }) => (MONTHS[month - 1] ?? "").slice(0, 3),
  MM: ({ month }) => pad(month, 2),
  M: ({ month }) => String(month),
  // Day of the month
  Do: ({ day }) => ordinal(day),
  dd: ({ day }) => pad(day, 2),
  d: ({ day }) => String(day),
  // Day of the week
  EEEE: ({ weekday }) => WEEKDAYS[weekday - 1] ?? "",
  EEE: ({ weekday }) => (WEEKDAYS[weekday - 1] ?? "").slice(0, 3),
  // Time
  HH: ({ hour }) => pad(hour, 2),
  H: ({ hour }) => String(hour),
  hh: ({ hour }) => pad(twelveHour(hour), 2),
  h: ({ hour }) => String(twelveHour(hour)),
  a: ({ hour }) => (hour < 12 ? "AM" : "PM"),
  mm: ({ minute }) => pad(minute, 2),
  ss: ({ second }) => pad(second, 2),
  SSS: ({ millisecond }) => pad(millisecond, 3),
  // Offset
  XXX: ({ offset }) => offsetText(offset),
};

// A quoted literal (to its closing quote, or the end), `Do`, a run of one
// letter, or anything that isn't a letter or a quote.
const PIECES = /'(?:[^']|'')*(?:'|$)|Do|([A-Za-z])\1*|[^A-Za-z']+/gu;

/** One piece of a pattern, shown. */
const show = (piece: string, parts: ZonedParts): string => {
  if (piece.startsWith("'")) {
    return piece === "''"
      ? "'"
      : piece.slice(1, piece.endsWith("'") ? -1 : undefined).replaceAll("''", "'");
  }

  if (!/^[A-Za-z]/u.test(piece)) {
    return piece;
  }

  const token = TOKENS[piece];

  if (token === undefined) {
    throw new RangeError(`format: "${piece}" is not a token; quote literal text, like 'at'`);
  }

  return token(parts);
};

/**
 * Shows `date` with `pattern`, in UTC or in `options.timeZone`. Throws a
 * `RangeError` for an invalid date, an unknown token or an unknown zone.
 *
 * | Token | Shows | Example |
 * | --- | --- | --- |
 * | `yyyy`, `yy` | year | `2026`, `26` |
 * | `MMMM`, `MMM`, `MM`, `M` | month | `October`, `Oct`, `10`, `10` |
 * | `Do`, `dd`, `d` | day of the month | `7th`, `07`, `7` |
 * | `EEEE`, `EEE` | day of the week | `Wednesday`, `Wed` |
 * | `HH`, `H`, `hh`, `h`, `a` | hour, 24- and 12-hour, and AM or PM | `14`, `14`, `02`, `2`, `PM` |
 * | `mm`, `ss`, `SSS` | minute, second, millisecond | `05`, `09`, `250` |
 * | `XXX` | UTC offset | `Z`, `+09:00` |
 */
export const format = (date: Date, pattern: string, options: FormatOptions = {}): string => {
  if (!isValid(date)) {
    throw new RangeError("format: the date is invalid");
  }

  const parts =
    options.timeZone === undefined ? utcParts(date) : zonedParts(date, options.timeZone);

  return (pattern.match(PIECES) ?? []).map((piece) => show(piece, parts)).join("");
};
