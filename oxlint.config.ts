import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";

const V3_OR_HOST_BOUND =
  "Effect v4 only: no v3 @effect/platform or @effect/cli, no effect/unstable/*, and no effect/workflow or effect/cluster (AGENTS.md principle 9).";

export default defineConfig({
  extends: [core, vitest],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    ".claude/**",
    ".codex/**",
    "tools/oxlint/anti-slop/**",
    "**/worker-configuration.d.ts",
    "examples/**",
    "apps/web/src/components/ui/**",
    "apps/web/src/routeTree.gen.ts",
  ],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    {
      name: "anti-slop-effect",
      specifier: "./tools/oxlint/anti-slop/effect/index.ts",
    },
  ],
  options: {
    typeAware: true,
  },
  overrides: [
    {
      // An override declares its plugins so its rule options stick.
      files: ["apps/web/**/*.{ts,tsx}"],
      plugins: react.plugins ?? [],
      rules: {
        ...react.rules,
        ...tanstack.rules,
      },
    },
    ...(tanstack.overrides ?? []).map((override) => ({
      ...override,
      files: override.files.map((glob) => `apps/web/${glob}`),
    })),
    {
      // Without `plugins` here, oxlint keeps Ultracite's override options and drops ours.
      files: [
        "**/*.{test,spec,test-d,spec-d}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
        "**/__tests__/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
      ],
      plugins: ["vitest"],
      rules: {
        // `@effect/vitest` test blocks: `it.effect(…, () => Effect.gen(…))`.
        "vitest/no-standalone-expect": [
          "error",
          {
            additionalTestBlockFunctions: [
              "it.effect",
              "it.effect.each",
              "it.effect.only",
              "it.effect.skip",
              "it.flakyTest",
              "it.layer",
              "it.live",
              "it.live.each",
              "it.prop",
              "layer",
            ],
          },
        ],
      },
    },
  ],
  rules: {
    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/prefer-effect-match": "error",
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
    // Effect: `Effect.gen(function* () {…})`; `Effect.fn("name")` names spans.
    "func-names": ["error", "always", { generators: "never" }],
    // Effect: Schema classes, tagged errors and services are all classes.
    "max-classes-per-file": "off",
    // Effect: `const X = Schema…` beside `type X = typeof X.Type`. tsc still
    // catches a real redeclaration.
    "no-redeclare": "off",
    "no-restricted-imports": [
      "error",
      {
        paths: [
          { message: V3_OR_HOST_BOUND, name: "@effect/platform" },
          { message: V3_OR_HOST_BOUND, name: "@effect/cli" },
          { message: V3_OR_HOST_BOUND, name: "effect/workflow" },
          { message: V3_OR_HOST_BOUND, name: "effect/cluster" },
        ],
        patterns: [
          {
            group: [
              "@effect/platform/*",
              "@effect/cli/*",
              "effect/unstable/*",
              "effect/workflow/*",
              "effect/cluster/*",
            ],
            message: V3_OR_HOST_BOUND,
          },
        ],
      },
    ],
    "oxc/no-accumulating-spread": "error",
    // Effect: its `asyncFunction` diagnostic bans `async`; promises appear only
    // where a library takes them, as plain promise-returning functions.
    "typescript/promise-function-async": "off",
    // Effect: `Effect.forEach(xs, f, { concurrency })` is not a `thisArg`.
    "unicorn/no-array-method-this-argument": "off",
    // Effect: `Schema.TaggedError<X>()(…)` returns a class, not an error.
    "unicorn/throw-new-error": "off",
  },
});
