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
