import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

it.effect("runs an Effect through @effect/vitest", () =>
  Effect.gen(function* () {
    expect(yield* Effect.succeed(1)).toBe(1);
  })
);
