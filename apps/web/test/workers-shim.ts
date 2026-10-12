// `vitest.config.ts` aliases `cloudflare:workers` here so a route module loads outside workerd;
// its `PLATFORM` throws when touched, so a test that reaches the platform passes its own env.
import { untouchable } from "@repo/testkit/untouchable";

export const env: Env = {
  PLATFORM: untouchable<Fetcher>("PLATFORM"),
  PUBLIC_PLATFORM_URL: "http://localhost:8787",
};
