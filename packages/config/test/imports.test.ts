import { describe, expect, it } from "@effect/vitest";

import {
  findViolations,
  formatViolation,
  importsOf,
  Matrix,
} from "../../../scripts/lib/imports.ts";
import type {
  ImportRule,
  SourceFile,
  Workspace,
} from "../../../scripts/lib/imports.ts";

// Every package exports its modules by subpath, as `package.json`'s
// `"./*": "./src/*.ts"` does.
const bySubpath = { "./*": ["./src/*.ts"] };

const workspace = (
  name: string,
  dir: string,
  dependencies: readonly string[]
): Workspace => ({ dependencies, dir, exports: bySubpath, name });

/** The tree's workspaces, shaped like the repo's. */
const workspaces: readonly Workspace[] = [
  {
    dependencies: ["@repo/brand", "@repo/protocol"],
    dir: "",
    name: "@repo/root",
  },
  workspace("@repo/brand", "packages/brand", ["@repo/config"]),
  workspace("@repo/config", "packages/config", []),
  workspace("@repo/protocol", "packages/protocol", [
    "@repo/brand",
    "@repo/config",
  ]),
  workspace("@repo/sdk", "packages/sdk", ["@repo/brand", "@repo/protocol"]),
  workspace("@repo/checks", "packages/checks", [
    "@repo/brand",
    "@repo/protocol",
  ]),
  // `@repo/project` is declared, so only the matrix can refuse the edge.
  workspace("@repo/gate", "packages/gate", [
    "@repo/checks",
    "@repo/project",
    "@repo/protocol",
  ]),
  workspace("@repo/artifacts", "packages/artifacts", ["@repo/protocol"]),
  // `@repo/brand` is left out: the matrix allows it, the manifest doesn't.
  workspace("@repo/git", "packages/git", [
    "@repo/artifacts",
    "@repo/config",
    "@repo/protocol",
  ]),
  workspace("@repo/project", "packages/project", ["@repo/protocol"]),
  workspace("@repo/testkit", "packages/testkit", ["@repo/protocol"]),
  workspace("@repo/platform", "apps/platform", [
    "@repo/brand",
    "@repo/checks",
    "@repo/protocol",
  ]),
  workspace("@repo/web", "apps/web", ["@repo/brand", "@repo/protocol"]),
  workspace("@repo/cli", "apps/cli", [
    "@repo/checks",
    "@repo/config",
    "@repo/protocol",
    "@repo/testkit",
  ]),
];

const file = (path: string, ...lines: readonly string[]): SourceFile => ({
  content: lines.join("\n"),
  path,
});

/** A tree that keeps every rule: each case below plants one fault in it. */
const clean: readonly SourceFile[] = [
  file(
    "apps/platform/src/worker.ts",
    'import { Contracts } from "@repo/protocol/contracts";',
    'import { isJudged } from "@repo/checks/judge";',
    'import { Buffer } from "node:buffer";',
    'import { serve } from "./surfaces.ts";'
  ),
  file("apps/platform/src/surfaces.ts", 'import { Brand } from "@repo/brand";'),
  file(
    "apps/cli/src/main.ts",
    'import { CheckRunnerLocal } from "@repo/checks/check-runner/local";'
  ),
  file(
    "apps/cli/test/stdio.ts",
    'import { asTester } from "@repo/protocol/testing";',
    'import { aProject } from "@repo/testkit/scenario";',
    'import { NodeServices } from "@effect/platform-node";'
  ),
  file(
    "packages/protocol/src/contracts.ts",
    'import { AskId } from "./ids.ts";'
  ),
  file("packages/protocol/src/ids.ts", 'import { Schema } from "effect";'),
  file(
    "packages/protocol/src/testing.ts",
    'import { Handle } from "./ids.ts";'
  ),
  // Test-only itself: its consumers are tests.
  file(
    "packages/testkit/src/scenario.ts",
    'export { asTester } from "@repo/protocol/testing";'
  ),
  file(
    "packages/protocol/test/examples.ts",
    'import { AskId } from "@repo/protocol/ids";',
    'export { asTester } from "../src/testing.ts";'
  ),
  file(
    "packages/sdk/src/kinds.ts",
    'import { Ask } from "@repo/protocol/domain/ask";'
  ),
  file(
    "packages/checks/src/judge.ts",
    'import type { RepoPath } from "@repo/protocol/ids";'
  ),
  file(
    "packages/checks/src/check-runner.ts",
    'import { Context } from "effect";'
  ),
  file(
    "packages/checks/src/check-runner/local.ts",
    'import { BunServices } from "@effect/platform-bun";',
    'import { CheckRunner } from "../check-runner.ts";'
  ),
  file(
    "packages/gate/src/shape.ts",
    'import { matchGlob } from "@repo/checks/judge";'
  ),
  file(
    "packages/artifacts/src/repo-host.ts",
    'import { CommitSha } from "@repo/protocol/ids";'
  ),
  file(
    "packages/artifacts/src/repo-host/memory.ts",
    'import { RepoHost } from "../repo-host.ts";',
    'import { memoryFs } from "./memory-fs.ts";'
  ),
  file("packages/artifacts/src/repo-host/memory-fs.ts"),
  // A file in a port's folder that isn't an adapter.
  file(
    "packages/project/src/lander.ts",
    'export { LandWire } from "./lander/wire.ts";'
  ),
  file("packages/project/src/lander/wire.ts"),
  file(
    "packages/git/test/git.ts",
    'import { spawn } from "node:child_process";'
  ),
  file(
    "packages/git/vitest.config.ts",
    'export { preset as default } from "@repo/config/vitest";'
  ),
  // Config's tests drive the root's fence: its scripts, tools and config.
  file(
    "packages/config/test/imports.test.ts",
    'import { findViolations } from "../../../scripts/lib/imports.ts";',
    'import oxlintConfig from "../../../oxlint.config.ts";'
  ),
  file("scripts/gen.ts", 'import { groups } from "@repo/protocol/refusal";'),
  file("infra/deploy.ts", 'import alchemy from "alchemy";'),
];

/** The clean tree with `planted` added, each replacing a file at its path. */
const plant = (...planted: readonly SourceFile[]) => [
  ...clean.filter((kept) => planted.every((other) => other.path !== kept.path)),
  ...planted,
];

interface Case {
  readonly name: string;
  readonly planted: readonly SourceFile[];
  readonly path: string;
  readonly specifier: string;
  readonly rule: ImportRule;
}

const refused = (
  name: string,
  rule: ImportRule,
  planted: SourceFile,
  specifier: string
): Case => ({ name, path: planted.path, planted: [planted], rule, specifier });

describe("import direction", () => {
  it("passes a tree that keeps every rule", () => {
    expect(findViolations(clean, workspaces)).toStrictEqual([]);
  });

  it.each<Case>([
    refused(
      "an app imports an app",
      "app-imports-app",
      file("apps/web/src/x.ts", 'import { platform } from "@repo/platform";'),
      "@repo/platform"
    ),
    refused(
      "an app imports an app by a type-only import",
      "app-imports-app",
      file(
        "apps/web/src/x.ts",
        'import type { Services } from "@repo/platform/surfaces";'
      ),
      "@repo/platform/surfaces"
    ),
    refused(
      "Worker code imports a host builtin",
      "worker-host",
      file(
        "apps/platform/src/x.ts",
        'import { spawn } from "node:child_process";'
      ),
      "node:child_process"
    ),
    refused(
      "Worker code imports a node builtin nodejs_compat doesn't serve",
      "worker-host",
      file("apps/platform/src/x.ts", 'import { readFile } from "node:fs";'),
      "node:fs"
    ),
    refused(
      "Worker code imports OpenTUI",
      "worker-host",
      file("apps/web/src/x.ts", 'import { render } from "@opentui/react";'),
      "@opentui/react"
    ),
    refused(
      "a package imports host code outside a /local or /bun adapter",
      "worker-host",
      file(
        "packages/checks/src/finder.ts",
        'import { spawn } from "node:child_process";'
      ),
      "node:child_process"
    ),
    refused(
      "a port imports its adapter",
      "adapter-through-port",
      file(
        "packages/artifacts/src/repo-host.ts",
        'import { RepoHostMemory } from "./repo-host/memory.ts";'
      ),
      "./repo-host/memory.ts"
    ),
    refused(
      "a port re-exports its adapter",
      "adapter-through-port",
      file(
        "packages/artifacts/src/repo-host.ts",
        'export * from "./repo-host/memory.ts";'
      ),
      "./repo-host/memory.ts"
    ),
    refused(
      "a port re-exports an adapter that runs in process",
      "adapter-through-port",
      file(
        "packages/project/src/answer-runs.ts",
        'export { AnswerRunsInline } from "./answer-runs/inline.ts";'
      ),
      "./answer-runs/inline.ts"
    ),
    refused(
      "a package reaches the root's scripts by a relative path",
      "adapter-through-port",
      file(
        "packages/gate/src/x.ts",
        'import { findViolations } from "../../../scripts/lib/imports.ts";'
      ),
      "../../../scripts/lib/imports.ts"
    ),
    refused(
      "a file reaches into another package by a relative path",
      "adapter-through-port",
      file(
        "apps/cli/src/x.ts",
        'import { AskId } from "../../../packages/protocol/src/ids.ts";'
      ),
      "../../../packages/protocol/src/ids.ts"
    ),
    refused(
      "gate imports project",
      "matrix",
      file(
        "packages/gate/src/x.ts",
        'import { Project } from "@repo/project";'
      ),
      "@repo/project"
    ),
    refused(
      "gate imports a checks subpath that runs processes",
      "matrix",
      file(
        "packages/gate/src/x.ts",
        'import { CheckRunnerLocal } from "@repo/checks/check-runner/local";'
      ),
      "@repo/checks/check-runner/local"
    ),
    refused(
      "a package's src imports the test config",
      "matrix",
      file(
        "packages/brand/src/x.ts",
        'import { preset } from "@repo/config/vitest";'
      ),
      "@repo/config/vitest"
    ),
    refused(
      "sdk imports protocol outside domain/*",
      "matrix",
      file(
        "packages/sdk/src/x.ts",
        'import { Contracts } from "@repo/protocol/contracts";'
      ),
      "@repo/protocol/contracts"
    ),
    refused(
      "a package imports a workspace its package.json doesn't declare",
      "undeclared",
      file("packages/git/src/x.ts", 'import { Brand } from "@repo/brand";'),
      "@repo/brand"
    ),
    refused(
      "a script imports a workspace the root doesn't declare",
      "undeclared",
      file("scripts/x.ts", 'import { gate } from "@repo/gate";'),
      "@repo/gate"
    ),
    refused(
      "src imports the test principal",
      "test-only",
      file(
        "packages/git/src/x.ts",
        'import { asTester } from "@repo/protocol/testing";'
      ),
      "@repo/protocol/testing"
    ),
    refused(
      "protocol's own src imports the test principal by a relative path",
      "test-only",
      file(
        "packages/protocol/src/x.ts",
        'import { asTester } from "./testing.ts";'
      ),
      "./testing.ts"
    ),
    refused(
      "src imports testkit",
      "test-only",
      file(
        "apps/cli/src/x.ts",
        'import { aProject } from "@repo/testkit/scenario";'
      ),
      "@repo/testkit/scenario"
    ),
    refused(
      "a script imports alchemy",
      "infra-only",
      file("scripts/x.ts", 'import alchemy from "alchemy/cloudflare";'),
      "alchemy/cloudflare"
    ),
  ])("refuses $name as $rule", ({ path, planted, rule, specifier }) => {
    expect(findViolations(plant(...planted), workspaces)).toStrictEqual([
      { line: 1, path, rule, specifier },
    ]);
  });

  it("refuses Worker code that reaches host code through a package, and names the chain", () => {
    const violations = findViolations(
      plant(
        file(
          "apps/platform/src/x.ts",
          'import { Schema } from "effect";',
          'import { CheckRunnerLocal } from "@repo/checks/check-runner/local";'
        )
      ),
      workspaces
    );

    expect(violations).toStrictEqual([
      {
        line: 2,
        path: "apps/platform/src/x.ts",
        rule: "worker-host",
        specifier: "@repo/checks/check-runner/local",
        via: [
          "packages/checks/src/check-runner/local.ts",
          "@effect/platform-bun",
        ],
      },
    ]);
    expect(violations.map(formatViolation)).toStrictEqual([
      "apps/platform/src/x.ts:2: worker-host: @repo/checks/check-runner/local → packages/checks/src/check-runner/local.ts → @effect/platform-bun",
    ]);
  });

  it("follows relative imports out of Worker code, and reports each fault once", () => {
    expect(
      findViolations(
        plant(
          file("apps/platform/src/a.ts", 'import { b } from "./b.ts";'),
          file(
            "apps/platform/src/b.ts",
            'import { harness } from "../test/harness.ts";'
          ),
          file(
            "apps/platform/test/harness.ts",
            'import { NodeServices } from "@effect/platform-node";'
          )
        ),
        workspaces
      )
    ).toStrictEqual([
      {
        line: 1,
        path: "apps/platform/src/b.ts",
        rule: "worker-host",
        specifier: "../test/harness.ts",
        via: ["apps/platform/test/harness.ts", "@effect/platform-node"],
      },
    ]);
  });

  it("reports the first rule an import breaks, and only that one", () => {
    // Undeclared, off the matrix and an app: the app rule comes first.
    expect(
      findViolations(
        plant(
          file(
            "apps/platform/src/x.ts",
            'import { mcp } from "@repo/cli/surfaces";'
          )
        ),
        workspaces
      ).map((violation) => violation.rule)
    ).toStrictEqual(["app-imports-app"]);
  });

  it("lists every row of the import matrix, absent packages included", () => {
    expect(Object.keys(Matrix).toSorted()).toStrictEqual([
      "@repo/agent-kit",
      "@repo/artifacts",
      "@repo/brand",
      "@repo/checks",
      "@repo/cli",
      "@repo/gate",
      "@repo/git",
      "@repo/platform",
      "@repo/project",
      "@repo/protocol",
      "@repo/rules",
      "@repo/sandbox",
      "@repo/sdk",
      "@repo/testkit",
      "@repo/visibility",
      "@repo/web",
    ]);
    expect(Matrix["@repo/gate"]).toStrictEqual([
      "@repo/checks",
      "@repo/protocol",
    ]);
    expect(Matrix["@repo/brand"]).toStrictEqual([]);
  });
});

describe("reading imports", () => {
  it("reads every import form, type-only ones too, with its line", () => {
    const content = [
      'import { Effect } from "effect";',
      'import type { Ask } from "@repo/protocol/domain/ask";',
      "import {",
      "  a,",
      "  b,",
      '} from "./multi.ts";',
      'export { c } from "./c.ts";',
      'export type { D } from "./d.ts";',
      'export * as e from "./e.ts";',
      'import "./side-effect.ts";',
      'const later = await import("./later.ts");',
      'type Worker = typeof import("./worker.ts");',
    ].join("\n");

    expect(importsOf({ content, path: "packages/x/src/a.ts" })).toStrictEqual([
      { line: 1, specifier: "effect", typeOnly: false },
      { line: 2, specifier: "@repo/protocol/domain/ask", typeOnly: true },
      { line: 6, specifier: "./multi.ts", typeOnly: false },
      { line: 7, specifier: "./c.ts", typeOnly: false },
      { line: 8, specifier: "./d.ts", typeOnly: true },
      { line: 9, specifier: "./e.ts", typeOnly: false },
      { line: 10, specifier: "./side-effect.ts", typeOnly: false },
      { line: 11, specifier: "./later.ts", typeOnly: false },
      { line: 12, specifier: "./worker.ts", typeOnly: true },
    ]);
  });

  it("skips import syntax inside strings, templates, regexes and comments", () => {
    const content = [
      '// import { x } from "@repo/cli";',
      "/* export * from '@repo/cli';",
      '   import("@repo/cli") */',
      "const quoted = 'import { mcp } from \"@repo/cli/surfaces\";';",
      "const doubled = \"export { a } from '@repo/cli'\";",
      // A template, with a template inside its `${…}`.
      `const template = \`import { b } from "@repo/cli" \${\`import("@repo/cli")\`}\`;`,
      'const pattern = /["\']import\\("@repo\\/cli"\\)/u;',
      'import { real } from "./real.ts";',
    ].join("\n");

    expect(importsOf({ content, path: "packages/x/src/a.ts" })).toStrictEqual([
      { line: 8, specifier: "./real.ts", typeOnly: false },
    ]);
  });
});
