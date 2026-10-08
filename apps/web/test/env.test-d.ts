/**
 * Principle 7's type fence: the web Worker's generated `Env` (from
 * `wrangler.jsonc`, by `bun run types`) reaches the platform only through
 * `PLATFORM`, and holds no Artifacts binding, public or private, so no code
 * in a public page can reach a repo.
 */
import { describe, expectTypeOf, it } from "vitest";

describe("the web Worker's Env", () => {
  it("reaches the platform through the PLATFORM service binding", () => {
    expectTypeOf<Env>().toHaveProperty("PLATFORM");
    expectTypeOf<Env["PLATFORM"]>().toEqualTypeOf<Fetcher>();
  });

  it("has no Artifacts binding, public or private", () => {
    expectTypeOf<Env>().not.toHaveProperty("ARTIFACTS");
    expectTypeOf<Env>().not.toHaveProperty("ARTIFACTS_PRIVATE");
    expectTypeOf<Extract<keyof Env, `ARTIFACTS${string}`>>().toBeNever();
  });
});
