/**
 * Principle 7's type fence, the positive side: the platform Worker's
 * generated `Env` (from `wrangler.jsonc`, by `bun run types`) holds both
 * Artifacts namespaces, the public one and the private one the layers live
 * in, deliberately. The web's `test/env.test-d.ts` is the negative side:
 * a Worker that serves public pages holds neither.
 */
import { describe, expectTypeOf, it } from "vitest";

describe("the platform Worker's Env", () => {
  it("holds the public namespace and the private one", () => {
    expectTypeOf<Env>().toHaveProperty("ARTIFACTS");
    expectTypeOf<Env>().toHaveProperty("ARTIFACTS_PRIVATE");
    expectTypeOf<Env["ARTIFACTS_PRIVATE"]>().toEqualTypeOf<Env["ARTIFACTS"]>();
  });

  it("holds no other Artifacts binding", () => {
    expectTypeOf<Extract<keyof Env, `ARTIFACTS${string}`>>().toEqualTypeOf<
      "ARTIFACTS" | "ARTIFACTS_PRIVATE"
    >();
  });
});
