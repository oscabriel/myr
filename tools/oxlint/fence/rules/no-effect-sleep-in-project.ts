import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { workspacePath } from "./no-module-level-mutable-state.ts";

/** Effect's two ways to wait on the clock in-process. */
const WAITS: ReadonlySet<string> = new Set(["delay", "sleep"]);

/** `packages/project`'s runtime source: the lifecycles and their service. */
const isProjectSource = (path: string) =>
  /^packages\/project\/src\/./u.test(path);

/** Whether a member access reads a wait: `x.sleep` or `x["sleep"]`. */
const readsWait = (node: ESTree.MemberExpression) => {
  const { property } = node;

  if (!node.computed && property.type === "Identifier") {
    return WAITS.has(property.name);
  }

  return (
    property.type === "Literal" &&
    [...WAITS].some((wait) => wait === property.value)
  );
};

/** The name an import specifier takes from its module. */
const importedName = (node: ESTree.ImportSpecifier) =>
  node.imported.type === "Identifier"
    ? node.imported.name
    : node.imported.value;

/**
 * Refuses `Effect.sleep` and `Effect.delay` in `packages/project/src`. A
 * lifecycle is a pure transition, and a deadline is a Durable Object alarm set
 * from what the transition returns, so a replay converges and nothing waits
 * inside a request (AGENTS.md principle 12).
 */
export const noEffectSleepInProject = defineRule({
  create(context) {
    if (!isProjectSource(workspacePath(context.filename, context.cwd))) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "effect/Effect") {
          return;
        }

        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            WAITS.has(importedName(specifier))
          ) {
            context.report({ messageId: "sleeps", node: specifier });
          }
        }
      },
      MemberExpression(node) {
        if (
          node.object.type === "Identifier" &&
          node.object.name === "Effect" &&
          readsWait(node)
        ) {
          context.report({ messageId: "sleeps", node });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Keep Effect.sleep and Effect.delay out of packages/project: deadlines are Durable Object alarms.",
    },
    messages: {
      sleeps:
        "packages/project never waits in-process. Return the deadline from the lifecycle's transition and let the Durable Object alarm fire it (AGENTS.md principle 12).",
    },
    type: "problem",
  },
});
