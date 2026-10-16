// `vitest.config.ts` aliases `cloudflare:workers` here so a route module loads outside workerd;
// its `PLATFORM` throws when touched, so a test that reaches the platform passes its own env.
import { untouchable } from "@repo/testkit/untouchable";

export const env: Env = {
  PLATFORM: untouchable<Fetcher>("PLATFORM"),
  PUBLIC_PLATFORM_URL: "http://localhost:8787",
};

// A route module's background work runs to its end in a test only when the test awaits it itself.
export const waitUntil = (_promise: Promise<unknown>): void => undefined;
