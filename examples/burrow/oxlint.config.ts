import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core, antiSlop],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    // The rule's fixtures keep the faults its test points at.
    "tools/oxlint/burrow/fixtures/**",
  ],
  jsPlugins: [{ name: "burrow", specifier: "./tools/oxlint/burrow/index.ts" }],
  rules: {
    // Every package's src/ runs inside long-lived server processes: state
    // kept in a module is shared by every request they handle. A warning
    // until the last module-level binding is gone, so the lint and its hook
    // stay green meanwhile; the count may only fall (the project's ratchet,
    // README "How we keep it tidy"). Then it becomes an error.
    "burrow/no-module-level-mutable-state": "warn",
  },
});
