import { defineConfig } from "vitest/config";

export const preset = defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
