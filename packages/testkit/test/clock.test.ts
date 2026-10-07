import { describe, expect, it } from "@effect/vitest";
import { Clock, DateTime, Duration, Effect, Fiber } from "effect";

import { advanceTo, at, defaultNow, hours } from "../src/clock.ts";

describe("the test clock helpers", () => {
  it("reads an ISO instant as a UTC date-time", () => {
    expect(DateTime.toEpochMillis(at("2026-10-07T12:00:00Z"))).toBe(
      1_791_374_400_000
    );
    expect(DateTime.isUtc(at("2026-10-07T12:00:00Z"))).toBeTruthy();
    expect(defaultNow).toStrictEqual(at("2026-10-07T12:00:00Z"));
  });

  it("counts hours as durations", () => {
    expect(Duration.toMillis(hours(2))).toBe(7_200_000);
    expect(Duration.toMillis(hours(24))).toBe(86_400_000);
  });

  it.effect("moves the test clock to an instant", () =>
    Effect.gen(function* () {
      yield* advanceTo("2026-10-07T12:00:00Z");

      expect(yield* Clock.currentTimeMillis).toBe(1_791_374_400_000);
      expect(yield* DateTime.now).toStrictEqual(at("2026-10-07T12:00:00Z"));
    })
  );

  it.effect(
    "wakes what sleeps until the instant it moves to, and nothing later",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-07T12:00:00Z");

        const warn = yield* Effect.forkChild(Effect.sleep(hours(2)));
        const lapse = yield* Effect.forkChild(Effect.sleep(hours(24)));

        yield* advanceTo("2026-10-07T14:00:00Z");

        expect(warn.pollUnsafe()).toBeDefined();
        expect(lapse.pollUnsafe()).toBeUndefined();

        yield* Fiber.interrupt(lapse);
      })
  );
});
