import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    // Prose is hand-shaped.
    "**/*.md",
    "tools/oxlint/anti-slop/**",
    "**/worker-configuration.d.ts",
    "examples/**",
  ],
});
