import { defineRule } from "@oxlint/plugins";

/** Stub: issue 102 ports the rule. The name and description are final. */
export const noModuleLevelMutableState = defineRule({
  create: () => ({}),
  meta: {
    docs: {
      description: "Keep state out of module-level let and var bindings.",
    },
    messages: {},
    type: "problem",
  },
});
