// Crash reporting. A defect is the platform's own fault, so it is logged at
// Error, with its cause and stack, where Issues groups it. A typed failure is
// never reported: a refusal is the product working (AGENTS.md principle 3),
// and a port's error is handled where it is typed.
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
 * Reports each defect once, through the reporting fiber's own loggers and
 * annotations, however many boundaries it crosses.
 */
export const defectReporter = (): ErrorReporter.ErrorReporter => {
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
