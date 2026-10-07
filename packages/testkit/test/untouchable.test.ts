import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { TouchedError, untouchable } from "../src/untouchable.ts";

interface Counter {
  readonly count: () => number;
  readonly reset: () => void;
}

describe(untouchable, () => {
  it("throws on any member a test did not give, naming it", () => {
    const counter = untouchable<Counter>("COUNTER");

    expect(() => {
      counter.reset();
    }).toThrow(new TouchedError("COUNTER", "reset"));
  });

  it("reads the members a test gave", () => {
    const counter = untouchable<Counter>("COUNTER", { count: () => 3 });

    expect(counter.count()).toBe(3);
    expect(() => {
      counter.reset();
    }).toThrow(TouchedError);
  });

  it.effect("resolves a promise without a read", () =>
    Effect.gen(function* () {
      const counter = untouchable<Counter>("COUNTER");

      expect(yield* Effect.promise(() => Promise.resolve(counter))).toBe(
        counter
      );
    })
  );
});
