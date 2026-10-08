/**
 * Time zones. datekit keeps every date as an instant and works in UTC; a
 * time zone matters only when a date is shown, so this module turns an
 * instant into the wall-clock fields of an IANA zone (`Europe/Lisbon`), with
 * the zone's offset at that instant. The zone data is the runtime's own
 * (`Intl`), so datekit ships none.
 */
import { MS_PER_MINUTE, isoWeekday, utcMidnight } from "./calendar.ts";

/** An instant's wall-clock fields in one zone, and the zone's offset from UTC then. */
export interface ZonedParts {
  readonly year: number;
  /** 1 to 12. */
  readonly month: number;
  readonly day: number;
  /** 0 to 23. */
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
  /** The ISO weekday: Monday is 1 and Sunday is 7. */
  readonly weekday: number;
  /** Minutes east of UTC: `+09:00` is 540. */
  readonly offset: number;
}

/** An instant's fields in UTC. */
export const utcParts = (date: Date): ZonedParts => ({
  day: date.getUTCDate(),
  hour: date.getUTCHours(),
  millisecond: date.getUTCMilliseconds(),
  minute: date.getUTCMinutes(),
  month: date.getUTCMonth() + 1,
  offset: 0,
  second: date.getUTCSeconds(),
  weekday: isoWeekday(date),
  year: date.getUTCFullYear(),
});

/** Whether the runtime knows `name` as a time zone. */
export const isTimeZone = (name: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });

    return true;
  } catch {
    return false;
  }
};

const fieldsIn = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    minute: "numeric",
    month: "numeric",
    second: "numeric",
    timeZone,
    year: "numeric",
  });

/**
 * An instant's fields in the IANA zone `timeZone`. Throws a `RangeError`
 * for a zone the runtime doesn't know.
 */
export const zonedParts = (date: Date, timeZone: string): ZonedParts => {
  const parts = new Map(
    fieldsIn(timeZone)
      .formatToParts(date)
      .map(({ type, value }) => [type, Number(value)]),
  );

  const field = (type: Intl.DateTimeFormatPartTypes) => parts.get(type) ?? 0;
  const millisecond = date.getUTCMilliseconds();
  const wall = new Date(utcMidnight(field("year"), field("month"), field("day")));

  // The wall clock read as if it were UTC, less the instant, is the offset.
  const wallTime =
    wall.getTime() +
    ((field("hour") * 60 + field("minute")) * 60 + field("second")) * 1000 +
    millisecond;

  return {
    day: field("day"),
    hour: field("hour"),
    millisecond,
    minute: field("minute"),
    month: field("month"),
    offset: Math.round((wallTime - date.getTime()) / MS_PER_MINUTE),
    second: field("second"),
    weekday: isoWeekday(wall),
    year: field("year"),
  };
};

/** The offset of `timeZone` from UTC at `date`, in minutes east of UTC. */
export const offsetIn = (date: Date, timeZone: string): number => zonedParts(date, timeZone).offset;
