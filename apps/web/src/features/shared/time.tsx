/**
 * A time as a short distance from now: "in 3 h", "2 d ago". `now` is a prop,
 * so a page and its test say the same thing; the exact time is the
 * element's `dateTime` and its tooltip.
 */
import { DateTime } from "effect";

const MINUTE = 60_000;

const HOUR = 60 * MINUTE;

const DAY = 24 * HOUR;

/** The largest whole unit in `millis`, as "5 min", "3 h" or "2 d". */
const span = (millis: number) => {
  if (millis < HOUR) {
    return `${Math.floor(millis / MINUTE)} min`;
  }

  return millis < DAY
    ? `${Math.floor(millis / HOUR)} h`
    : `${Math.floor(millis / DAY)} d`;
};

/** How far `at` is from `now`, in words. */
export const distanceInWords = (at: DateTime.Utc, now: DateTime.Utc) => {
  const millis = DateTime.toEpochMillis(at) - DateTime.toEpochMillis(now);

  if (Math.abs(millis) < MINUTE) {
    return "now";
  }

  return millis > 0 ? `in ${span(millis)}` : `${span(-millis)} ago`;
};

export const When = ({
  at,
  now,
}: {
  readonly at: DateTime.Utc;
  readonly now: DateTime.Utc;
}) => {
  const iso = DateTime.formatIso(at);

  return (
    <time dateTime={iso} title={iso}>
      {distanceInWords(at, now)}
    </time>
  );
};
