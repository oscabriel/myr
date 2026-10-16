// Crash reporting. A defect is the platform's own fault, so it is logged at
// Error, with its cause and stack, where Issues groups it. A typed failure is
// never reported: a refusal is the product working (AGENTS.md principle 3),
// and a port's error is handled where it is typed. Where a defect's text may
// quote what no log may hold, it is kept by its name and frames alone.
import {
  Array,
  Cause,
  Context,
  DateTime,
  Effect,
  ErrorReporter,
  Logger,
  Predicate,
} from "effect";

const NANOS_PER_MILLI = 1_000_000n;

class ReportedElsewhere extends Context.Service<ReportedElsewhere, true>()(
  "telemetry/ReportedElsewhere"
) {}

/**
 * What a report keeps of a defect: all of it, scrubbed, or its name and the
 * frames of its stack alone, where its text may quote what no log may hold
 * (a layer's repo, a held-back check's path).
 */
export type DefectKeeping = "whole" | "name";

const WITHHELD = "<withheld>";

const FRAME = /^\s+at /u;

const CONSTANT = /^[A-Z][A-Z0-9_]{0,63}$/u;

/** The defect as Effect prints it: an `Error`, whatever it died with. */
export const prettyOf = (reason: Cause.Die): Error | undefined =>
  Cause.prettyErrors(Cause.fromReasons([reason]))[0];

/**
 * A defect's `code` where it is a constant's name or a whole number
 * (`INTERNAL_ERROR`, `ENOENT`, `10400`): one of a closed set, which can quote
 * no repo, path or value, and tells one failure of a port from another.
 */
export const codeOf = (reason: Cause.Die): string | number | undefined => {
  const { defect } = reason;

  if (!Predicate.hasProperty(defect, "code")) {
    return undefined;
  }

  const { code } = defect;

  if (Predicate.isString(code)) {
    return CONSTANT.test(code) ? code : undefined;
  }

  return Predicate.isNumber(code) && Number.isSafeInteger(code)
    ? code
    : undefined;
};

/** `kept` with the defect's code, where `codeOf` keeps one. */
export const withCode = (kept: Error, reason: Cause.Die): Error => {
  const code = codeOf(reason);

  return code === undefined ? kept : Object.assign(kept, { code });
};

/**
 * A defect kept by its name, its code where `codeOf` keeps one, and the
 * frames of its stack alone: an `Error`, so it reads as itself where it is
 * turned into text, never as `[object Object]`.
 */
export const keptByName = (reason: Cause.Die): Error => {
  const error = prettyOf(reason);
  const name = error?.name ?? "Error";
  const code = codeOf(reason);
  const message = code === undefined ? WITHHELD : `${WITHHELD} (${code})`;
  const kept = new Error(message);

  kept.name = name;
  // The frames Effect adds for its spans included; the message, and any
  // cause the defect carries, left out.
  kept.stack = [
    `${name}: ${message}`,
    ...(error?.stack ?? "").split("\n").filter((line) => FRAME.test(line)),
  ].join("\n");

  return withCode(kept, reason);
};

const withheld = (reason: Cause.Die): Cause.Die =>
  Cause.makeDieReason(keptByName(reason));

/** `cause` with each defect kept by its name and stack frames alone. */
export const unquoted = <E>(cause: Cause.Cause<E>): Cause.Cause<E> =>
  Cause.fromReasons(
    cause.reasons.map((reason) =>
      Cause.isDieReason(reason) ? withheld(reason) : reason
    )
  );

/**
 * Reports each defect once, through the reporting fiber's own loggers and
 * annotations, however many boundaries it crosses.
 */
export const defectReporter = (
  keeping: DefectKeeping = "whole"
): ErrorReporter.ErrorReporter => {
  const seen = new WeakSet<object>();

  const unreported = <E>(reason: Cause.Reason<E>): readonly Cause.Die[] => {
    if (
      !Cause.isDieReason(reason) ||
      ErrorReporter.isIgnored(reason.defect) ||
      Context.getOrUndefined(
        Cause.reasonAnnotations(reason),
        ReportedElsewhere
      ) === true
    ) {
      return [];
    }

    if (Predicate.isObject(reason.defect)) {
      if (seen.has(reason.defect)) {
        return [];
      }

      seen.add(reason.defect);
    }

    return [reason];
  };

  return {
    [ErrorReporter.TypeId]: ErrorReporter.TypeId,
    report: ({ cause, fiber, timestamp }) => {
      const defects = cause.reasons.flatMap(unreported);

      if (!Array.isReadonlyArrayNonEmpty(defects)) {
        return;
      }

      const whole = Cause.fromReasons(defects);
      const reported = keeping === "name" ? unquoted(whole) : whole;
      const [first] = Cause.prettyErrors(reported);

      const date = DateTime.toDateUtc(
        DateTime.makeUnsafe(Number(timestamp / NANOS_PER_MILLI))
      );

      for (const logger of fiber.getRef(Logger.CurrentLoggers)) {
        logger.log({
          cause: reported,
          date,
          fiber,
          logLevel: "Error",
          message: [
            first === undefined
              ? "a defect"
              : `${first.name}: ${first.message}`,
          ],
        });
      }
    },
  };
};

/**
 * Marks the defects of a cause another side reported already, with the stack
 * only it held: one that comes back over a wire (a Durable Object's reply) is
 * reported there, never again here. The mark rides on the cause, so the
 * defect itself stays as it came.
 */
export const reportedElsewhere = <E>(cause: Cause.Cause<E>): Cause.Cause<E> =>
  Cause.annotate(cause, Context.make(ReportedElsewhere, true));

/**
 * A reporting boundary: reports the defects `effect` dies with, then marks
 * them, so a boundary further out lets them pass. Its place is where the
 * invocation's ids annotate the logs, so the report carries them.
 */
export const reportDefects = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.catchCauseIf(Cause.hasDies, (cause) =>
      Effect.andThen(
        ErrorReporter.report(cause),
        Effect.failCause(reportedElsewhere(cause))
      )
    )
  );
