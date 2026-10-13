// Crash reporting. A defect is the platform's own fault, so it is logged at
// Error, with its cause and stack, where Issues groups it. A typed failure is
// never reported: a refusal is the product working (AGENTS.md principle 3),
// and a port's error is handled where it is typed.
import {
  Array,
  Cause,
  DateTime,
  ErrorReporter,
  Logger,
  Predicate,
} from "effect";

const NANOS_PER_MILLI = 1_000_000n;

/**
 * Reports each defect once, through the reporting fiber's own loggers and
 * annotations, however many boundaries it crosses.
 */
export const defectReporter = (): ErrorReporter.ErrorReporter => {
  const seen = new WeakSet<object>();

  const unreported = <E>(reason: Cause.Reason<E>): readonly Cause.Die[] => {
    if (!Cause.isDieReason(reason) || ErrorReporter.isIgnored(reason.defect)) {
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

      const reported = Cause.fromReasons(defects);
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

const reported = <A>(defect: A) => {
  if (Predicate.isObject(defect)) {
    Object.defineProperty(defect, ErrorReporter.ignore, { value: true });

    return defect;
  }

  const marked = new Error(String(defect));

  Object.defineProperty(marked, ErrorReporter.ignore, { value: true });

  return marked;
};

/**
 * Marks the defects of a cause another side reported already, with the stack
 * only it held: one that comes back over a wire (a Durable Object's reply) is
 * reported there, never again here.
 */
export const reportedElsewhere = <E>(cause: Cause.Cause<E>): Cause.Cause<E> =>
  Cause.fromReasons(
    cause.reasons.map((reason) =>
      Cause.isDieReason(reason)
        ? Cause.makeDieReason(reported(reason.defect))
        : reason
    )
  );
