/**
 * The dev world's time: one clock that every part of the world reads, as a
 * test's TestClock is. The seed and the fixtures are written against one
 * fixed calendar, which starts at `devStart`: each step names its instant
 * on it (`devMinute`, or a fixture's date), and the seed sets the clock
 * there step by step. A world places that calendar on time by one offset,
 * the distance from `devStart` to where the world starts, so every instant
 * it holds is the calendar's moved by the same amount and the gaps between
 * them are as written.
 *
 * A world built for a test starts at `devStart` and its clock stands still
 * where the seed left it, so every timestamp is the same on every run. The
 * running dev server (`backend.ts`) starts its world so that the seed's
 * last instant is the minute it starts in (`startEndingNow`), and its clock
 * runs on from there in real time (`run`), so a page in a browser reads a
 * deadline as the seed meant it and sees it come. Elapsed time and sleeping,
 * which nothing in the world does, are always real.
 */
import { Clock, Context, DateTime, Duration, Effect, Layer } from "effect";

/** The dev world's clock: where its calendar stands, and the way to move it. */
export class DevClock extends Context.Service<
  DevClock,
  {
    /** The calendar's instant `at`, as it stands in this world. */
    readonly place: (at: DateTime.Utc) => DateTime.Utc;
    /** Stands the clock at the calendar's instant `at`; a running clock runs on from there. */
    readonly set: (at: DateTime.Utc) => Effect.Effect<void>;
    /** From the instant it stands at, the clock moves in real time. */
    readonly run: Effect.Effect<void>;
    /**
     * When something that happens now happens: on a running clock, the
     * present; on one standing still, a minute after where it stands, which
     * it then stands at, so the thing reads as after all before it.
     */
    readonly step: Effect.Effect<DateTime.Utc>;
  }
>()("web/dev/DevClock") {}

const NANOS_PER_MILLI = 1_000_000n;

/** Where the calendar starts: every instant the seed writes is this one or a whole minute after. */
export const devStart: DateTime.Utc = DateTime.toUtc(
  DateTime.makeUnsafe("2026-10-07T09:00:00Z")
);

/** The calendar's instant `minutes` whole minutes after its start. */
export const devMinute = (minutes: number): DateTime.Utc =>
  DateTime.add(devStart, { minutes });

/**
 * Where a world starts whose calendar instant `end` is the present minute:
 * the clock read once, rounded down to its minute, less the calendar's
 * distance from its start to `end`.
 */
export const startEndingNow = (
  end: DateTime.Utc
): Effect.Effect<DateTime.Utc> =>
  Effect.map(DateTime.now, (now) =>
    DateTime.subtractDuration(
      DateTime.startOf(now, "minute"),
      DateTime.distance(devStart, end)
    )
  );

/**
 * A world's clock, whose calendar starts at `start`: standing at `start`
 * until it is set or run, and the way to do either.
 */
export const devClockAt = (start: DateTime.Utc): Layer.Layer<DevClock> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const real = yield* Clock.Clock;
      const offset = DateTime.distance(devStart, start);

      const place = (at: DateTime.Utc) => DateTime.addDuration(at, offset);

      // The instant the clock was last stood at, and, once it runs, the
      // monotonic reading it has run from since.
      let stood = DateTime.toEpochMillis(start);
      let runningSince: bigint | undefined;

      const elapsedNanos = () =>
        runningSince === undefined
          ? 0n
          : real.monotonicTimeNanosUnsafe() - runningSince;

      const nanos = () => BigInt(stood) * NANOS_PER_MILLI + elapsedNanos();

      const millis = () => Number(nanos() / NANOS_PER_MILLI);

      const standAt = (at: number) => {
        stood = at;

        if (runningSince !== undefined) {
          runningSince = real.monotonicTimeNanosUnsafe();
        }
      };

      const clock: Clock.Clock = {
        currentTimeMillis: Effect.sync(millis),
        currentTimeMillisUnsafe: millis,
        currentTimeNanos: Effect.sync(nanos),
        currentTimeNanosUnsafe: nanos,
        // Elapsed time is measured, never seeded.
        monotonicTimeNanos: real.monotonicTimeNanos,
        monotonicTimeNanosUnsafe: () => real.monotonicTimeNanosUnsafe(),
        sleep: (duration) => real.sleep(duration),
      };

      const devClock = DevClock.of({
        place,
        run: Effect.sync(() => {
          runningSince ??= real.monotonicTimeNanosUnsafe();
        }),
        set: (at) =>
          Effect.sync(() => {
            standAt(DateTime.toEpochMillis(place(at)));
          }),
        step: Effect.sync(() => {
          if (runningSince !== undefined) {
            return DateTime.toUtc(DateTime.makeUnsafe(millis()));
          }

          standAt(millis() + Duration.toMillis(Duration.minutes(1)));

          return DateTime.toUtc(DateTime.makeUnsafe(stood));
        }),
      });

      return Context.make(DevClock, devClock).pipe(
        Context.add(Clock.Clock, clock)
      );
    })
  );
