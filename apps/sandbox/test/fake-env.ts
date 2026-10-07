import { untouchable } from "@repo/testkit/untouchable";

/**
 * The sandbox Worker's env, as `wrangler.jsonc` declares it: each binding a
 * fake that throws if touched, so a test proves what a call touches.
 */
export const fakeEnv = (): Env => ({
  CHECKER: untouchable("CHECKER"),
  LANDER: untouchable("LANDER"),
});
