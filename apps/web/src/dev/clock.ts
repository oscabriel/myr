/**
 * The dev world's time: one clock that every part of the world reads, as a
 * test's TestClock is, standing still at the instant it was last set. The
 * seed sets it step by step from one fixed start (`seed.ts`), and the world
 * then serves at the instant the seed left it, so a decision opened by the
 * seed never expires under a developer and every timestamp is the same on
 * every run. Sleeping, which nothing in the world does, waits in real time.
 */
import { Clock, Context, DateTime, Effect, Layer } from "effect";

/** Moves the dev world's clock to an instant. */
export class DevClock extends Context.Service<
  DevClock,
  { readonly set: (at: DateTime.Utc) => Effect.Effect<void> }
>()("web/dev/DevClock") {}

const NANOS_PER_MILLI = 1_000_000n;

/** Where the world's time starts: every instant the seed writes is this one or a whole minute after. */
export const devStart: DateTime.Utc = DateTime.toUtc(
  DateTime.makeUnsafe("2026-10-07T09:00:00Z")
);

/** The instant `minutes` whole minutes after the world's start. */
export const devMinute = (minutes: number): DateTime.Utc =>
  DateTime.add(devStart, { minutes });

/** A clock standing at `start` until it is set elsewhere, and the way to set it. */
export const devClockAt = (start: DateTime.Utc): Layer.Layer<DevClock> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const real = yield* Clock.Clock;
      let millis = DateTime.toEpochMillis(start);

      const nanos = () => BigInt(millis) * NANOS_PER_MILLI;

      const clock: Clock.Clock = {
        currentTimeMillis: Effect.sync(() => millis),
        currentTimeMillisUnsafe: () => millis,
        currentTimeNanos: Effect.sync(nanos),
        currentTimeNanosUnsafe: nanos,
        // Elapsed time is measured, never seeded.
        monotonicTimeNanos: real.monotonicTimeNanos,
        monotonicTimeNanosUnsafe: () => real.monotonicTimeNanosUnsafe(),
        sleep: (duration) => real.sleep(duration),
      };

      const devClock = DevClock.of({
        set: (at) =>
          Effect.sync(() => {
            millis = DateTime.toEpochMillis(at);
          }),
      });

      return Context.make(DevClock, devClock).pipe(
        Context.add(Clock.Clock, clock)
      );
    })
  );
