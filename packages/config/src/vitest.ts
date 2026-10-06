import { defineConfig } from "vitest/config";

/** The one vitest setup every package uses: tests live in `test/`, run in Node. */
export const preset = defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
