/**
 * The repo's own lint rules. `oxlint.config.ts` runs every rule but
 * `debt-ledger`, which reports each escape directive and so runs only through
 * `oxlint.debt.config.ts` for the `debt` count.
 */
import { definePlugin } from "@oxlint/plugins";

import { debtLedger } from "./rules/debt-ledger.ts";
import { noManualEffectRuntimeInTests } from "./rules/no-manual-effect-runtime-in-tests.ts";
import { noModuleLevelMutableState } from "./rules/no-module-level-mutable-state.ts";

export default definePlugin({
  meta: { name: "fence" },
  rules: {
    "debt-ledger": debtLedger,
    "no-manual-effect-runtime-in-tests": noManualEffectRuntimeInTests,
    "no-module-level-mutable-state": noModuleLevelMutableState,
  },
});
