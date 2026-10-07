import { defineRule } from "@oxlint/plugins";

/** Stub: issue 102 ports the rule. The name and description are final. */
export const noManualEffectRuntimeInTests = defineRule({
  create: () => ({}),
  meta: {
    docs: {
      description:
        "Disallow manually creating or running Effect runtimes in tests; use @effect/vitest.",
    },
    messages: {},
    type: "problem",
  },
});
