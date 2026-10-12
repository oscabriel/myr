import { DateTime, Duration } from "effect";
import type { Effect } from "effect";
import { TestClock } from "effect/testing";

export const at = (iso: string): DateTime.Utc =>
  DateTime.toUtc(DateTime.makeUnsafe(iso));

export const defaultNow: DateTime.Utc = at("2026-10-07T12:00:00Z");

/**
 * Moves the TestClock to an instant, waking everything that sleeps until then:
 * `advanceTo("2026-10-07T14:00:00Z")` lets a claim's two-hour alarm fire.
 */
export const advanceTo = (iso: string): Effect.Effect<void> =>
  TestClock.setTime(DateTime.toEpochMillis(at(iso)));

export const hours = (n: number): Duration.Duration => Duration.hours(n);
