// Ported from joelhooks/rat-stack@fba26d8 `scripts/oxlint-plugin-effect-tests.ts`
// (MIT, LICENSES/rat-stack.MIT.txt), itself adapted from pingdotgg/t3code
// `oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.ts` (MIT,
// LICENSES/t3code.MIT.txt). Changes are listed in tools/oxlint/fence/UPSTREAM.md.
import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

const EFFECT_RUNTIME_METHODS: ReadonlySet<string> = new Set([
  "runCallback",
  "runCallbackWith",
  "runFork",
  "runForkWith",
  "runPromise",
  "runPromiseExit",
  "runPromiseExitWith",
  "runPromiseWith",
  "runSync",
  "runSyncExit",
  "runSyncExitWith",
  "runSyncWith",
]);

const isManualRunner = (callee: ESTree.Node) => {
  if (
    callee.type !== "MemberExpression" ||
    callee.object.type !== "Identifier" ||
    callee.property.type !== "Identifier"
  ) {
    return false;
  }

  const object = callee.object.name;
  const method = callee.property.name;

  return (
    (object === "Effect" && EFFECT_RUNTIME_METHODS.has(method)) ||
    (object === "ManagedRuntime" && method === "make")
  );
};

/**
 * Refuses an Effect run or a runtime built by hand in a `*.test.*` or
 * `*.spec.*` file: `@effect/vitest` runs it, with a TestClock and a Scope.
 */
export const noManualEffectRuntimeInTests = defineRule({
  create(context) {
    if (!TEST_FILE_PATTERN.test(context.filename)) {
      return {};
    }

    return {
      CallExpression(node) {
        if (isManualRunner(node.callee)) {
          context.report({ messageId: "manualRunner", node: node.callee });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Disallow manually creating or running Effect runtimes in tests; use @effect/vitest.",
    },
    messages: {
      manualRunner:
        "Do not run Effects by hand in tests. Use @effect/vitest: it.effect(...) or it.layer(layer)(...).",
    },
    type: "problem",
  },
});
