// Ported from joelhooks/rat-stack@fba26d8 `scripts/oxlint-plugin-patterns.ts`
// l.28–43 and l.621–677 (MIT, LICENSES/rat-stack.MIT.txt). Changes are listed
// in tools/oxlint/fence/UPSTREAM.md.
import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

/**
 * The file's path from its workspace on: `packages/<name>/src/…` or
 * `apps/<name>/src/…`. Read from the path string alone, so a copy of that
 * layout anywhere (a lint fixture, a temporary tree) counts the same. The path
 * is made relative to oxlint's working directory first, so the folders above
 * the one oxlint runs from never match.
 */
const workspacePath = (filename: string, cwd: string) => {
  const slashed = filename.replaceAll("\\", "/");
  const root = `${cwd.replaceAll("\\", "/")}/`;

  const relative = slashed.startsWith(root)
    ? slashed.slice(root.length)
    : slashed;

  const match =
    /(?:^|\/)(?<workspace>(?:apps|packages)\/[^/]+\/src\/.+)$/u.exec(relative);

  return match?.groups?.workspace ?? relative;
};

/** Code that runs in a Worker isolate or a server process. */
const isRuntimeSource = (path: string) =>
  /^(?:apps|packages)\/[^/]+\/src\/./u.test(path);

/** A `var` hoists to the nearest function, static block or namespace. */
const isModuleScopedVar = (node: ESTree.Node) => {
  let current = node.parent;

  while (current !== null && current.type !== "Program") {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionDeclaration" ||
      current.type === "FunctionExpression" ||
      current.type === "StaticBlock" ||
      current.type === "TSDeclareFunction" ||
      current.type === "TSModuleBlock"
    ) {
      return false;
    }

    current = current.parent;
  }

  return current?.type === "Program";
};

/**
 * Refuses a `let` or `var` at module scope in `apps/<name>/src` and
 * `packages/<name>/src`: a Worker isolate keeps its module state across
 * requests.
 */
export const noModuleLevelMutableState = defineRule({
  create(context) {
    if (!isRuntimeSource(workspacePath(context.filename, context.cwd))) {
      return {};
    }

    return {
      VariableDeclaration(node) {
        // `declare let` names a binding something else owns; it holds nothing.
        if (
          (node.kind !== "let" && node.kind !== "var") ||
          node.declare === true
        ) {
          return;
        }

        const scope = context.sourceCode.getScope(node);

        const moduleScoped =
          node.kind === "let"
            ? scope.type === "module" || scope.type === "global"
            : isModuleScopedVar(node);

        if (moduleScoped) {
          context.report({ messageId: "moduleState", node });
        }
      },
    };
  },
  meta: {
    docs: {
      description: "Keep state out of module-level let and var bindings.",
    },
    messages: {
      moduleState:
        "Module-level let and var are shared by every request a Worker isolate or server process handles. Keep state in a Ref inside a Layer, a Durable Object, or the database.",
    },
    type: "problem",
  },
});
