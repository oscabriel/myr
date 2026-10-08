/**
 * burrow's own lint rules, registered as the `burrow` plugin in
 * `oxlint.config.ts`.
 */
import { definePlugin } from "@oxlint/plugins";

import { noModuleLevelMutableState } from "./rules/no-module-level-mutable-state.ts";

export default definePlugin({
  meta: { name: "burrow" },
  rules: {
    "no-module-level-mutable-state": noModuleLevelMutableState,
  },
});
