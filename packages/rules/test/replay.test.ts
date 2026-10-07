import { describe, expect, it } from "@effect/vitest";
import { Policy } from "@repo/protocol/domain/policy";
import { DateTime, Effect, Schema } from "effect";

import { RulesEvaluator } from "../src/rules-evaluator.ts";
import type { ConfigBundle, EvaluationFacts } from "../src/rules-evaluator.ts";
import {
  at,
  baseProject,
  bundleOf,
  bunEvaluator,
  facts,
  folder,
  now,
  nowMs,
} from "./world.ts";

/** Evaluates a bundle with the given facts, and encodes the policy. */
const evaluated = (modules: ConfigBundle, with_: EvaluationFacts = facts) =>
  Effect.gen(function* () {
    const evaluator = yield* RulesEvaluator;
    const policy = yield* evaluator.evaluate({ at, facts: with_, modules });

    return yield* Schema.encodeEffect(Policy)(policy);
  });

/**
 * A config whose `project.ts` reads the clock and randomness while it loads,
 * and puts what it read into an ask's context: the wall clock, a dated
 * `new Date()`, a `Math.random()`, and a `new Date(0)` that names its time.
 */
const readsTheClock = Effect.map(baseProject, (base) =>
  bundleOf({
    "asks/stamp.ask.ts": [
      'import { stamp } from "../project.ts";',
      "export default {",
      "  blockedBy: [],",
      '  brief: { context: stamp, want: "Show the clock config code sees" },',
      '  check: { _tag: "RedThenGreen", path: "test/stamp.repro.test.ts" },',
      '  kind: "fix",',
      '  territory: { module: ".", paths: ["**"] },',
      "};",
    ].join("\n"),
    "project.ts": [
      "export const stamp = [",
      "  String(Date.now()),",
      "  new Date().toISOString(),",
      "  String(Math.random()),",
      "  new Date(0).toISOString(),",
      "];",
      base,
    ].join("\n"),
  })
);

/** What the clock-reading config put into its ask's context. */
const stampOf = (policy: typeof Policy.Encoded) =>
  policy.asks[0]?.brief.context;

describe("evaluating a config folder twice", () => {
  it.live("gives equal policies for equal facts", () =>
    Effect.gen(function* () {
      const modules = yield* folder("cm");
      const first = yield* evaluated(modules);
      const second = yield* evaluated(modules);

      expect(second).toStrictEqual(first);
    }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live("gives config code the facts' clock, not the wall clock", () =>
    Effect.gen(function* () {
      const modules = yield* readsTheClock;
      const first = stampOf(yield* evaluated(modules));

      const later = stampOf(
        yield* evaluated(modules, {
          ...facts,
          now: DateTime.makeUnsafe("2027-01-01T00:00:00.000Z"),
        })
      );

      expect(first?.slice(0, 2)).toStrictEqual([nowMs, now]);

      expect(later?.slice(0, 2)).toStrictEqual([
        "1798761600000",
        "2027-01-01T00:00:00.000Z",
      ]);

      // A date that names its own time is left alone.
      expect(first?.[3]).toBe("1970-01-01T00:00:00.000Z");
    }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live("gives config code randomness from the facts' seed", () =>
    Effect.gen(function* () {
      const modules = yield* readsTheClock;

      const randomWith = (seed: number) =>
        Effect.map(
          evaluated(modules, { ...facts, seed }),
          (policy) => stampOf(policy)?.[2]
        );

      const first = yield* randomWith(7);

      expect(yield* randomWith(7)).toBe(first);
      expect(yield* randomWith(8)).not.toBe(first);
      expect(Number(first)).toBeGreaterThanOrEqual(0);
      expect(Number(first)).toBeLessThan(1);
    }).pipe(Effect.provide(bunEvaluator()))
  );
});
