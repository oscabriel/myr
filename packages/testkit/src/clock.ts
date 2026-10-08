/**
 * Time for tests, on top of the TestClock `@effect/vitest`'s `it.effect`
 * provides. Like everything in `@repo/testkit`, this module is for `test/`
 * directories only: no `src/` imports it.
 */
import { DateTime, Duration } from "effect";
import type { Effect } from "effect";
import { TestClock } from "effect/testing";

/** An ISO 8601 instant, such as `2026-10-07T12:00:00Z`, as a UTC date-time. */
export const at = (iso: string): DateTime.Utc =>
  DateTime.toUtc(DateTime.makeUnsafe(iso));

/** The instant every scenario starts at unless it is given another. */
export const defaultNow: DateTime.Utc = at("2026-10-07T12:00:00Z");

/**
 * Moves the TestClock to an instant, waking everything that sleeps until then:
 * `advanceTo("2026-10-07T14:00:00Z")` lets a claim's two-hour alarm fire.
 */
export const advanceTo = (iso: string): Effect.Effect<void> =>
  TestClock.setTime(DateTime.toEpochMillis(at(iso)));

/** `n` hours, the unit claims are warned and lapsed in. */
export const hours = (n: number): Duration.Duration => Duration.hours(n);
