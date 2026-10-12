import { Clock, Context, DateTime, Duration, Effect, Layer } from "effect";

export class DevClock extends Context.Service<
  DevClock,
  {
    readonly place: (at: DateTime.Utc) => DateTime.Utc;
    readonly set: (at: DateTime.Utc) => Effect.Effect<void>;
    readonly run: Effect.Effect<void>;
    /** On a running clock, the present; on one standing still, a minute after where it stands, so each thing reads as after all before it. */
    readonly step: Effect.Effect<DateTime.Utc>;
  }
>()("web/dev/DevClock") {}

const NANOS_PER_MILLI = 1_000_000n;

export const devStart: DateTime.Utc = DateTime.toUtc(
  DateTime.makeUnsafe("2026-10-07T09:00:00Z")
);

export const devMinute = (minutes: number): DateTime.Utc =>
  DateTime.add(devStart, { minutes });

export const startEndingNow = (
  end: DateTime.Utc
): Effect.Effect<DateTime.Utc> =>
  Effect.map(DateTime.now, (now) =>
    DateTime.subtractDuration(
      DateTime.startOf(now, "minute"),
      DateTime.distance(devStart, end)
    )
  );

export const devClockAt = (start: DateTime.Utc): Layer.Layer<DevClock> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const real = yield* Clock.Clock;
      const offset = DateTime.distance(devStart, start);

      const place = (at: DateTime.Utc) => DateTime.addDuration(at, offset);

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
