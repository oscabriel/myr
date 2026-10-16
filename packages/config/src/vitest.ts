import { defineConfig } from "vitest/config";

export const preset = defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 20s, not vitest's 5s: the Checker runs every workspace's tests at once on
    // one container, where a case that spawns git or a CLI can outlast 5s.
    testTimeout: 20_000,
  },
});
