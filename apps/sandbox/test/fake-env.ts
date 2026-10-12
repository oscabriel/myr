import { untouchable } from "@repo/testkit/untouchable";

export const fakeEnv = (): Env => ({
  CHECKER: untouchable("CHECKER"),
  LANDER: untouchable("LANDER"),
});
