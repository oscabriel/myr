// A Worker's logger: one object per line, its annotations fields of their
// own, written through the console method of its level. Workers Logs indexes
// the fields of an object it is handed, so `project` or `requestId` is a field
// to filter on, and Issues groups what reaches `console.error`. Effect's
// `consoleJson` would hand Workers Logs a string, with the annotations nested
// under `annotations`, and write every level through `console.log`.
import { Array, Logger, Predicate, Redacted } from "effect";

import { unquoted } from "./defects.ts";
import type { DefectKeeping } from "./defects.ts";

/** Takes every secret a Worker holds out of a text it is about to log. */
export type Scrub = (text: string) => string;

const REDACTED = "<redacted>";

/** Longest first, so a secret that holds another leaves no part of itself behind. */
export const scrubberOf = (secrets: readonly Redacted.Redacted[]): Scrub => {
  const values = secrets
    .flatMap((secret) => {
      const value = Redacted.value(secret);

      return value === "" ? [] : [value];
    })
    .toSorted((a, b) => b.length - a.length);

  return (text) => {
    let kept = text;

    for (const value of values) {
      kept = kept.replaceAll(value, REDACTED);
    }

    return kept;
  };
};

// Workers Logs names a line's level as its console method does, in lowercase
// (`error`, `warn`, `info`), and a logged object's own `level` takes its
// place: Effect's `ERROR` would read as no error where a query asks for
// `level = 'error'`, as smoke and the alerts do. A fatal line is an error.
const workersLevel = (level: string) =>
  level === "FATAL" ? "error" : level.toLowerCase();

// A cause rides on a warning as well as on a report: where a defect is kept by
// its name, it is kept so on every line, whichever call logs it.
const structuredKeeping = (defects: DefectKeeping) =>
  defects === "name"
    ? Logger.make((options) =>
        Logger.formatStructured.log({
          ...options,
          cause: unquoted(options.cause),
        })
      )
    : Logger.formatStructured;

export const jsonLogger = (
  scrub: Scrub,
  defects: DefectKeeping = "whole"
): Logger.Logger<unknown, void> =>
  Logger.withLeveledConsole(
    Logger.map(
      structuredKeeping(defects),
      ({ annotations, cause, level, message, spans }) => {
        const scrubbed = <A>(value: A) =>
          Predicate.isString(value) ? scrub(value) : value;

        return Object.fromEntries([
          ...Object.entries(annotations).map(
            ([key, value]) => [key, scrubbed(value)] as const
          ),
          [
            "message",
            Array.isArray(message) ? message.map(scrubbed) : scrubbed(message),
          ],
          ["level", workersLevel(level)],
          ...(cause === undefined ? [] : [["cause", scrub(cause)] as const]),
          ...(Object.keys(spans).length === 0
            ? []
            : [["spans", spans] as const]),
        ]);
      }
    )
  );
