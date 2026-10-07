/**
 * The debt count's own config: one rule, `fence/debt-ledger`, that reports
 * every escape directive. `scripts/debt.ts` runs it with `-A all` so no default
 * category leaks in. Generated, vendored, example and fixture files are not
 * the product's own code, so their escapes are not counted.
 */
import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: [
    "node_modules",
    ".agent_sources/**",
    "tools/oxlint/anti-slop/**",
    "tools/oxlint/fence/fixtures/**",
    "**/worker-configuration.d.ts",
    "docs/**",
    "skills/**",
    "plugins/**",
    "examples/**",
  ],
  jsPlugins: [{ name: "fence", specifier: "./tools/oxlint/fence/index.ts" }],
  rules: { "fence/debt-ledger": "error" },
});
