/**
 * `cloudflare:workers` for tests in Node: `vitest.config.ts` aliases the
 * module here (config aliasing, not module mocking), so a route module that
 * reads the Worker's `env` loads outside workerd. The env is the local
 * stage's, and its `PLATFORM` binding throws when touched: a test that means
 * to reach the platform passes its own env to the handler under test.
 */
import { untouchable } from "@repo/testkit/untouchable";

export const env: Env = {
  PLATFORM: untouchable<Fetcher>("PLATFORM"),
  PUBLIC_PLATFORM_URL: "http://localhost:8787",
};
