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

const evaluated = (modules: ConfigBundle, with_: EvaluationFacts = facts) =>
  Effect.gen(function* () {
    const evaluator = yield* RulesEvaluator;
    const policy = yield* evaluator.evaluate({ at, facts: with_, modules });

    return yield* Schema.encodeEffect(Policy)(policy);
  });

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
      "  String(new Date().constructor.now()),",
      "  new Date(0).toISOString(),",
      "  String(Math.random()),",
      '  crypto.getRandomValues(new Uint32Array(2)).join(","),',
      "  crypto.randomUUID(),",
      "];",
      base,
    ].join("\n"),
  })
);

const stampOf = (policy: typeof Policy.Encoded) =>
  policy.asks[0]?.brief.context;

describe("evaluating a config folder twice", () => {
  it.live(
    "gives equal policies for equal facts",
    () =>
      Effect.gen(function* () {
        for (const modules of [yield* folder("cm"), yield* readsTheClock]) {
          const first = yield* evaluated(modules);
          const second = yield* evaluated(modules);

          expect(second).toStrictEqual(first);
        }
      }).pipe(Effect.provide(bunEvaluator())),
    // Four bun processes: a third of a second alone, near four while turbo
    // runs every package's tests at once. The limit catches a hang.
    30_000
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

      expect(first?.slice(0, 3)).toStrictEqual([nowMs, now, nowMs]);

      expect(later?.slice(0, 3)).toStrictEqual([
        "1798761600000",
        "2027-01-01T00:00:00.000Z",
        "1798761600000",
      ]);

      expect(first?.[3]).toBe("1970-01-01T00:00:00.000Z");
    }).pipe(Effect.provide(bunEvaluator()))
  );

  it.live("gives config code randomness from the facts' seed", () =>
    Effect.gen(function* () {
      const modules = yield* readsTheClock;

      const randomWith = (seed: number) =>
        Effect.map(
          evaluated(modules, { ...facts, seed }),
          (policy) => stampOf(policy)?.slice(4) ?? []
        );

      const first = yield* randomWith(7);
      const other = yield* randomWith(8);

      // The same seed gives the same three values; another seed changes each.
      expect({
        again: yield* randomWith(7),
        changed: other.map((value, index) => value !== first[index]),
      }).toStrictEqual({ again: first, changed: [true, true, true] });
      expect(Number(first[0])).toBeGreaterThanOrEqual(0);
      expect(Number(first[0])).toBeLessThan(1);
      expect(first[2]).toMatch(
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u
      );
    }).pipe(Effect.provide(bunEvaluator()))
  );
});
