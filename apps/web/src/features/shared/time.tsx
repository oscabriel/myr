import { DateTime } from "effect";

const MINUTE = 60_000;

const HOUR = 60 * MINUTE;

const DAY = 24 * HOUR;

const span = (millis: number) => {
  if (millis < HOUR) {
    return `${Math.floor(millis / MINUTE)} min`;
  }

  return millis < DAY
    ? `${Math.floor(millis / HOUR)} h`
    : `${Math.floor(millis / DAY)} d`;
};

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
