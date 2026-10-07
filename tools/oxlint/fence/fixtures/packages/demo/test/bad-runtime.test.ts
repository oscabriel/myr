import { expect, it } from "@effect/vitest";
import { Effect, Layer, ManagedRuntime } from "effect";

it("runs an Effect by hand", async () => {
  expect(await Effect.runPromise(Effect.succeed(1))).toBe(1);
});

it("builds a runtime by hand", async () => {
  const runtime = ManagedRuntime.make(Layer.empty);
  await runtime.dispose();
});
