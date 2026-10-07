import { NodeServices } from "@effect/platform-node";
import { describe, expect, it, layer } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Command } from "@repo/protocol/domain/common";
import type { RunBlock } from "@repo/protocol/domain/run";
import { LaneName, RepoPath } from "@repo/protocol/ids";
import { gitOk } from "@repo/testkit/git";
import { Context, Effect, FileSystem, Layer, Path } from "effect";

import type { RepoFile } from "../src/finder.ts";
import {
  commandScripts,
  defaultJudgeGlobs,
  eslintLocalPlugins,
  isJudged,
  jsPluginSpecifiers,
  judgeClosure,
  matchGlob,
  ruleFixtures,
  touchedPointers,
  tsconfigChain,
} from "../src/judge.ts";
import type { JudgeClosure } from "../src/judge.ts";

const file = (path: string, content = ""): RepoFile => ({ content, path });

/** A fence-shaped monorepo: root scripts, a tsconfig chain, a lint config, a hook config. */
const fence: readonly RepoFile[] = [
  file(
    "package.json",
    JSON.stringify({
      dependencies: { effect: "4.0.1" },
      scripts: {
        lint: "oxlint",
        test: "turbo run test",
        typecheck: "tsc --noEmit",
      },
    })
  ),
  file("tsconfig.json", JSON.stringify({ extends: "./tsconfig.base.json" })),
  file("tsconfig.base.json", JSON.stringify({ compilerOptions: {} })),
  file(
    "packages/parse/package.json",
    JSON.stringify({ scripts: { test: "vitest run" } })
  ),
  file(
    "packages/parse/tsconfig.json",
    JSON.stringify({ extends: ["../../configs/strict", "@tsconfig/node24"] })
  ),
  file("configs/strict.json", JSON.stringify({ extends: "./base.json" })),
  file("configs/base.json", JSON.stringify({ compilerOptions: {} })),
  file("packages/parse/vitest.config.ts", "export default {};"),
  file("oxlint.config.ts", "export default {};"),
  file("lefthook.yml", "pre-commit:\n  commands: {}\n"),
  file(".github/workflows/ci.yml", "jobs: {}\n"),
  file("test.sh", "#!/bin/sh\nbun test\n"),
  file("scripts/count.ts", "export {};"),
  file("src/a.ts", "export const a = 1;"),
];

const run: RunBlock = {
  checks: {
    [LaneName.make("lint")]: Command.make("bun run lint"),
    [LaneName.make("ratchet")]: Command.make(
      "bun scripts/count.ts --json --manifest=package.json"
    ),
    [LaneName.make("unit")]: Command.make("./test.sh"),
  },
  setup: Command.make("bun install --frozen-lockfile"),
  test: Command.make("bun test {path}"),
};

const closure = judgeClosure(run, fence);

describe(judgeClosure, () => {
  it("holds every default glob the spec names", () => {
    expect(closure.paths).toStrictEqual(
      expect.arrayContaining([
        `${Brand.configDir}/**`,
        "**/.env.schema",
        "**/.env.*",
        "!**/.env.local",
        "!**/.env.*.local",
        ".github/workflows/**",
        ".forgejo/**",
        "**/vitest.config.*",
        "**/oxlint.config.*",
        "**/tsconfig*.json",
        "lefthook.yml",
        ".husky/**",
        ".pre-commit-config.yaml",
        ".claude/settings*.json",
        ".cursor/hooks.json",
        ".pi/**",
        ".agents/skills/*-contribute/**",
      ])
    );
    expect(
      defaultJudgeGlobs.filter((glob) => !closure.paths.includes(glob))
    ).toStrictEqual([]);
  });

  it("adds the files the run commands name, and only files that exist", () => {
    expect(closure.paths).toContain("test.sh");
    expect(closure.paths).toContain("scripts/count.ts");
    expect(closure.paths).not.toContain("--json");
    expect(closure.paths).not.toContain("{path}");
  });

  it("follows a tsconfig's extends chain to files the defaults miss, and skips package specifiers", () => {
    expect(closure.paths).toContain("tsconfig.base.json");
    expect(closure.paths).toContain("configs/strict.json");
    expect(closure.paths).toContain("configs/base.json");
    expect(
      closure.paths.filter((glob) => glob.includes("@tsconfig"))
    ).toStrictEqual([]);
  });

  it("judges each package.json's scripts by pointer, never the whole file", () => {
    expect(closure.pointers).toStrictEqual([
      "package.json#/scripts",
      "packages/parse/package.json#/scripts",
    ]);
    expect(closure.paths).not.toContain("package.json");
  });

  it("gives the same closure for the same files in any order", () => {
    expect(judgeClosure(run, fence.toReversed())).toStrictEqual(closure);
  });

  it("walks a check script's own folder, never into the product it checks", () => {
    const judge = judgeClosure(
      {
        checks: {
          [LaneName.make("api")]: Command.make("bun scripts/check-api.ts"),
          [LaneName.make("unit")]: Command.make("bun test test/parse.test.ts"),
          [LaneName.make("root")]: Command.make("node check.mjs"),
        },
        test: Command.make("bun test {path}"),
      },
      [
        file(
          "scripts/check-api.ts",
          'import * as api from "../src/index.ts";\nimport { snap } from "./lib/snap.ts";'
        ),
        file("scripts/lib/snap.ts"),
        file(
          "test/parse.test.ts",
          'import { parse } from "../src/parse.ts";\nimport { cases } from "./cases.ts";'
        ),
        file("test/cases.ts"),
        file("check.mjs", 'import "./src/parse.ts";'),
        file("src/index.ts", 'export * from "./parse.ts";'),
        file("src/parse.ts"),
      ]
    );

    expect(
      [
        "scripts/check-api.ts",
        "scripts/lib/snap.ts",
        "test/parse.test.ts",
        "test/cases.ts",
        "check.mjs",
        "src/index.ts",
        "src/parse.ts",
      ].filter((path) => isJudged(judge, path))
    ).toStrictEqual([
      "scripts/check-api.ts",
      "scripts/lib/snap.ts",
      "test/parse.test.ts",
      "test/cases.ts",
      "check.mjs",
    ]);
  });
});

describe(isJudged, () => {
  it.each([
    [".github/workflows/ci.yml", true],
    [`${Brand.configDir}/project.ts`, true],
    [`${Brand.configDir}/asks/fix-week.ask.ts`, true],
    [".env.schema", true],
    ["apps/web/.env.schema", true],
    [".env.production", true],
    [".env.local", false],
    [".env.production.local", false],
    ["packages/parse/vitest.config.ts", true],
    ["packages/parse/tsconfig.json", true],
    ["configs/strict.json", true],
    ["test.sh", true],
    [".husky/pre-commit", true],
    [".claude/settings.local.json", true],
    [".agents/skills/parsekit-contribute/SKILL.md", true],
    [".agents/skills/other/SKILL.md", false],
    ["package.json", false],
    ["packages/parse/package.json", false],
    ["src/a.ts", false],
    ["README.md", false],
  ])("%s is judged: %s", (path, judged) => {
    expect(isJudged(closure, path)).toBe(judged);
  });
});

describe(touchedPointers, () => {
  const before = file(
    "package.json",
    JSON.stringify({
      dependencies: { effect: "4.0.1" },
      scripts: { lint: "oxlint", test: "vitest run" },
    })
  );

  it("leaves dependency edits alone", () => {
    const after = file(
      "package.json",
      JSON.stringify({
        dependencies: { effect: "4.0.1", yaml: "2.9.1" },
        scripts: { lint: "oxlint", test: "vitest run" },
      })
    );

    expect(touchedPointers(closure, before, after)).toStrictEqual([]);
  });

  it("names the scripts pointer when a script changes", () => {
    const after = file(
      "package.json",
      JSON.stringify({ scripts: { lint: "oxlint", test: "true" } })
    );

    expect(touchedPointers(closure, before, after)).toStrictEqual([
      "package.json#/scripts",
    ]);
  });

  it("ignores scripts that only moved, or reformatting", () => {
    const after = file(
      "package.json",
      JSON.stringify(
        {
          dependencies: { effect: "4.0.1" },
          scripts: { lint: "oxlint", test: "vitest run" },
        },
        null,
        2
      )
    );

    expect(touchedPointers(closure, before, after)).toStrictEqual([]);
  });

  it("counts a deleted, added or unreadable package.json as touched", () => {
    expect(touchedPointers(closure, before)).toStrictEqual([
      "package.json#/scripts",
    ]);
    expect(touchedPointers(closure, undefined, before)).toStrictEqual([
      "package.json#/scripts",
    ]);
    expect(
      touchedPointers(closure, before, file("package.json", "{ broken"))
    ).toStrictEqual(["package.json#/scripts"]);
  });

  it("matches a workspace package's pointer by its own path only", () => {
    const nested = (test: string) =>
      file(
        "packages/parse/package.json",
        JSON.stringify({ scripts: { test } })
      );

    expect(
      touchedPointers(closure, nested("vitest run"), nested("exit 0"))
    ).toStrictEqual(["packages/parse/package.json#/scripts"]);
    expect(
      touchedPointers(closure, file("src/a.ts", "1"), file("src/a.ts", "2"))
    ).toStrictEqual([]);
  });
});

const contentsOf = (...files: readonly RepoFile[]) =>
  new Map(files.map((one) => [one.path, one.content]));

describe(tsconfigChain, () => {
  it("follows a three-level chain written as JSONC, from a package to the root", () => {
    const files = contentsOf(
      file(
        "packages/a/tsconfig.json",
        '{\n  // the package\n  "extends": "../../tsconfig.lib.json",\n}\n'
      ),
      file(
        "tsconfig.lib.json",
        '{ "extends": "./tsconfig.base.json", /* the library */ }'
      ),
      file(
        "tsconfig.base.json",
        '{ "$schema": "https://json.schemastore.org/tsconfig", "compilerOptions": { "strict": true, }, }'
      )
    );

    expect(
      tsconfigChain(RepoPath.make("packages/a/tsconfig.json"), files)
    ).toStrictEqual({
      chain: [
        "packages/a/tsconfig.json",
        "tsconfig.lib.json",
        "tsconfig.base.json",
      ],
      notes: [],
    });
  });

  it("follows every entry of an array extends, and a package extends is not a path", () => {
    const files = contentsOf(
      file(
        "tsconfig.json",
        JSON.stringify({ extends: ["./a.json", "@tsconfig/node24", "./b"] })
      ),
      file("a.json", JSON.stringify({ extends: "./b.json" })),
      file("b.json", JSON.stringify({ extends: "./a.json" }))
    );

    expect(tsconfigChain(RepoPath.make("tsconfig.json"), files)).toStrictEqual({
      chain: ["tsconfig.json", "a.json", "b.json"],
      notes: [],
    });
  });

  it("finds a workspace package's config by the package's folder", () => {
    const files = contentsOf(
      file(
        "apps/web/tsconfig.json",
        JSON.stringify({ extends: "@repo/typescript-config/nextjs.json" })
      ),
      file(
        "packages/typescript-config/package.json",
        JSON.stringify({ name: "@repo/typescript-config" })
      ),
      file(
        "packages/typescript-config/nextjs.json",
        JSON.stringify({ extends: "./base.json" })
      ),
      file("packages/typescript-config/base.json", "{}")
    );

    expect(
      tsconfigChain(RepoPath.make("apps/web/tsconfig.json"), files).chain
    ).toStrictEqual([
      "apps/web/tsconfig.json",
      "packages/typescript-config/nextjs.json",
      "packages/typescript-config/base.json",
    ]);
  });

  it("stops at a malformed file, keeps it in the chain, and says why", () => {
    const files = contentsOf(
      file("tsconfig.json", JSON.stringify({ extends: "./broken.json" })),
      file("broken.json", '{ "extends": "./never.json"')
    );

    expect(tsconfigChain(RepoPath.make("tsconfig.json"), files)).toStrictEqual({
      chain: ["tsconfig.json", "broken.json"],
      notes: [
        "broken.json: not JSON, even with comments and trailing commas removed; the walk stops here",
      ],
    });
  });

  it("keeps a target it was not given, named as tsc would read it", () => {
    const files = contentsOf(
      file("tsconfig.json", JSON.stringify({ extends: "./configs/strict" }))
    );

    expect(tsconfigChain(RepoPath.make("tsconfig.json"), files)).toStrictEqual({
      chain: ["tsconfig.json", "configs/strict.json"],
      notes: ["configs/strict.json: not among the files read; judged unread"],
    });
  });
});

describe("the judge closure over tsconfig chains", () => {
  it("judges every file of a three-level and an array chain, and no package", () => {
    const judge = judgeClosure(run, [
      file(
        "packages/a/tsconfig.json",
        '{ "extends": "../../configs/lib.json", }'
      ),
      file("configs/lib.json", '{ "extends": "./base" /* tsc adds .json */ }'),
      file("configs/base.json", "{}"),
      file(
        "tsconfig.json",
        JSON.stringify({
          extends: ["./a.json", "./b.json", "@tsconfig/node24"],
        })
      ),
      file("a.json", "{}"),
      file("b.json", "{}"),
      file("c.json", "{}"),
    ]);

    expect(
      [
        "configs/lib.json",
        "configs/base.json",
        "a.json",
        "b.json",
        "c.json",
      ].filter((path) => isJudged(judge, path))
    ).toStrictEqual([
      "configs/lib.json",
      "configs/base.json",
      "a.json",
      "b.json",
    ]);
    expect(
      judge.paths.filter((glob) => glob.includes("@tsconfig"))
    ).toStrictEqual([]);
    expect(judge.notes).toBeUndefined();
  });
});

describe(jsPluginSpecifiers, () => {
  it("reads an .oxlintrc.json's jsPlugins, strings and objects, from its folder; a package name is no path", () => {
    expect(
      jsPluginSpecifiers(
        file(
          "packages/web/.oxlintrc.json",
          `{
            // local rules first
            "jsPlugins": [
              "./lint/plugin.mjs",
              "eslint-plugin-foo",
              { "name": "shared", "specifier": "../../tools/shared/index.js" },
            ],
          }`
        )
      )
    ).toStrictEqual(["packages/web/lint/plugin.mjs", "tools/shared/index.js"]);
  });

  it("scans an oxlint.config.ts's jsPlugins array as text, skipping comments", () => {
    const config = `import { defineConfig } from "oxlint";
      export default defineConfig({
        jsPlugins: [
          { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
          // { name: "old", specifier: "./tools/oxlint/old/index.ts" },
          { name: "fence", specifier: "./tools/oxlint/fence/index.ts" },
          "oxlint-plugin-package",
        ],
        rules: { "fence/rule": "error" },
      });`;

    expect(jsPluginSpecifiers(file("oxlint.config.ts", config))).toStrictEqual([
      "tools/oxlint/anti-slop/index.ts",
      "tools/oxlint/fence/index.ts",
    ]);
  });

  it("reads a jsPlugins array the config assigns to a variable first", () => {
    const config = `const jsPlugins = ["./lint/plugin.mjs", "oxlint-plugin-package"];
      export default defineConfig({ jsPlugins });`;

    expect(jsPluginSpecifiers(file("oxlint.config.ts", config))).toStrictEqual([
      "lint/plugin.mjs",
    ]);
  });

  it("finds nothing in a malformed .oxlintrc.json", () => {
    expect(
      jsPluginSpecifiers(file(".oxlintrc.json", '{ "jsPlugins": ["./a.mjs"'))
    ).toStrictEqual([]);
  });
});

describe(eslintLocalPlugins, () => {
  it("names every relative module an eslint config imports or requires", () => {
    const config = `import js from "@eslint/js";
      import local from "./eslint/rules/index.js";
      // import gone from "./eslint/gone.js";
      const base = require("../shared/eslint-base.cjs");
      export default [js.configs.recommended, local, base];`;

    expect(
      eslintLocalPlugins(file("web/eslint.config.js", config))
    ).toStrictEqual(["web/eslint/rules/index.js", "shared/eslint-base.cjs"]);
  });
});

describe("the judge closure over lint plugins", () => {
  const oxlintRun: RunBlock = {
    checks: { [LaneName.make("lint")]: Command.make("oxlint") },
    test: Command.make("vitest run {path}"),
  };

  it("judges an oxlint plugin's source, what it imports and its fixture folders, never a package plugin", () => {
    const judge = judgeClosure(oxlintRun, [
      file(
        ".oxlintrc.json",
        JSON.stringify({
          jsPlugins: ["./lint/plugin.mjs", "eslint-plugin-foo"],
        })
      ),
      file("lint/plugin.mjs", 'import rule from "./rules/no-foo.mjs";'),
      file("lint/rules/no-foo.mjs", "export default {};"),
      file("lint/test/plugin.test.mjs"),
      file("lint/tests/cases.json"),
      file("lint/__fixtures__/bad.js"),
      file("lint/notes.md"),
      file("src/a.ts"),
    ]);

    expect(
      [
        "lint/plugin.mjs",
        "lint/rules/no-foo.mjs",
        "lint/test/plugin.test.mjs",
        "lint/tests/cases.json",
        "lint/__fixtures__/bad.js",
        "lint/notes.md",
        "src/a.ts",
      ].filter((path) => isJudged(judge, path))
    ).toStrictEqual([
      "lint/plugin.mjs",
      "lint/rules/no-foo.mjs",
      "lint/test/plugin.test.mjs",
      "lint/tests/cases.json",
      "lint/__fixtures__/bad.js",
    ]);
    expect(
      judge.paths.filter((glob) => glob.includes("eslint-plugin-foo"))
    ).toStrictEqual([]);
  });

  it("judges an eslint config's local plugin folder whole, and a workspace lint package", () => {
    const judge = judgeClosure(oxlintRun, [
      file(
        "eslint.config.js",
        'import local from "./eslint/rules/index.js";\nimport shared from "@repo/eslint-config/base";'
      ),
      file("eslint/rules/index.js", 'export * from "./no-bar.js";'),
      file("eslint/rules/no-bar.js"),
      file(
        "packages/eslint-config/package.json",
        JSON.stringify({ name: "@repo/eslint-config" })
      ),
      file("packages/eslint-config/base.js"),
    ]);

    expect(judge.paths).toContain("eslint/rules/**");
    expect(isJudged(judge, "eslint/rules/no-bar.js")).toBeTruthy();
    expect(isJudged(judge, "packages/eslint-config/base.js")).toBeTruthy();
  });

  it("judges a malformed .oxlintrc.json and says why the walk stopped there", () => {
    const judge = judgeClosure(oxlintRun, [
      file(".oxlintrc.json", '{ "jsPlugins": ["./lint/plugin.mjs"'),
      file("tsconfig.json", "{ broken"),
    ]);

    expect(isJudged(judge, ".oxlintrc.json")).toBeTruthy();
    expect(isJudged(judge, "tsconfig.json")).toBeTruthy();
    expect(judge.notes).toStrictEqual([
      ".oxlintrc.json: not JSON, even with comments and trailing commas removed; the walk stops here",
      "tsconfig.json: not JSON, even with comments and trailing commas removed; the walk stops here",
    ]);
  });
});

describe(ruleFixtures, () => {
  const tree = contentsOf(
    file("tools/lint/index.ts", 'export * from "./rules/no-x.ts";'),
    file("tools/lint/rules/no-x.ts"),
    file("tools/test/no-x.test.ts"),
    file("lint/plugin.mjs"),
    file("lint/test/plugin.test.mjs", 'import plugin from "../plugin.mjs";'),
    file(
      "packages/config/test/lint-rules.test.ts",
      'import { rule } from "../../../tools/lint/rules/no-x.ts";'
    ),
    file(
      "packages/config/test/wiring.test.ts",
      'const plugin = { name: "local", specifier: "./lint/plugin.mjs" };'
    ),
    file(
      "packages/config/test/paths.ts",
      'export const fixtures = "tools/lint/fixtures";'
    ),
    file("packages/a/test/no-sort-rule.test.ts"),
    file(
      "packages/a/test/a.test.ts",
      'import "../lint/plugin.mjs";\nconst other = "eslint/plugin.mjs";\nconst near = "tools/linter/x.ts";'
    ),
    file(
      "packages/a/src/uses-lint.ts",
      'import "../../../tools/lint/index.ts";'
    )
  );

  it("names the folders beside each plugin, *-rule tests, and every test that names a plugin", () => {
    expect(
      ruleFixtures(
        [
          RepoPath.make("tools/lint/index.ts"),
          RepoPath.make("lint/plugin.mjs"),
        ],
        [...tree.keys()].map((path) => RepoPath.make(path)),
        tree
      )
    ).toStrictEqual([
      "**/*-rule.spec.*",
      "**/*-rule.test.*",
      "lint/__fixtures__/**",
      "lint/test/**",
      "lint/tests/**",
      "packages/config/test/lint-rules.test.ts",
      "packages/config/test/paths.ts",
      "packages/config/test/wiring.test.ts",
      "tools/__fixtures__/**",
      "tools/test/**",
      "tools/tests/**",
    ]);
  });

  it("names nothing when the repo has no local plugin", () => {
    expect(
      ruleFixtures(
        [],
        [...tree.keys()].map((path) => RepoPath.make(path)),
        tree
      )
    ).toStrictEqual([]);
  });
});

describe(commandScripts, () => {
  it("names the tracked files commands run, through quotes and a project-dir variable", () => {
    const tracked = new Set([
      "scripts/hooks/x.ts",
      ".husky/y.mjs",
      ".claude/hooks/stop.sh",
      "scripts/pre-push.sh",
      "package.json",
      "bun.lock",
      "requirements-dev.txt",
    ]);

    expect(
      commandScripts(
        [
          `bun "\${CLAUDE_PROJECT_DIR}/scripts/hooks/x.ts"`,
          "node .husky/y.mjs --strict",
          '"$CLAUDE_PROJECT_DIR"/.claude/hooks/stop.sh',
          "bash $(git rev-parse --show-toplevel)/scripts/pre-push.sh",
          "bun run lint",
          "jq .scripts package.json && cat bun.lock",
          "pip install -r requirements-dev.txt",
        ],
        tracked
      )
    ).toStrictEqual([
      ".claude/hooks/stop.sh",
      ".husky/y.mjs",
      "scripts/hooks/x.ts",
      "scripts/pre-push.sh",
    ]);
  });
});

describe("the judge closure over harness hooks", () => {
  const hooks: readonly RepoFile[] = [
    file(
      ".codex/hooks.json",
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ command: "bun scripts/hooks/x.ts", type: "command" }] },
          ],
        },
      })
    ),
    file(
      ".codex/config.toml",
      '# The Stop hook reads src/*.ts (Codex\'s own)\n[[hooks.Stop]]\ncommand = "bash tools/stop.sh"\n'
    ),
    file(
      ".github/hooks/policy.json",
      JSON.stringify({
        hooks: {
          preToolUse: [
            {
              bash: "./tools/guard.sh",
              powershell: "tools/guard.ps1",
              type: "command",
            },
          ],
        },
        version: 1,
      })
    ),
    file(".github/copilot/settings.json", "{}"),
    file(
      ".gemini/settings.json",
      JSON.stringify({
        hooks: {
          BeforeTool: [
            {
              hooks: [
                {
                  args: ["tools/gemini-guard.mjs"],
                  command: "node",
                  type: "command",
                },
              ],
            },
          ],
        },
      })
    ),
    file(
      ".opencode/plugins/guard.ts",
      'import { decide } from "../../scripts/hooks/lib/policy.ts";\nexport const guard = "bun tools/opencode.ts";'
    ),
    file(".amp/plugins/guard.ts"),
    file(
      ".claude/settings.local.json",
      `{
        // this machine's own
        "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "\\"$CLAUDE_PROJECT_DIR\\"/.claude/hooks/stop.sh" }] }] },
        "permissions": { "allow": ["Read(src/a.ts)"] },
      }`
    ),
    file(".husky/pre-commit", "node .husky/y.mjs\nbun run lint\n"),
    file(".husky/y.mjs"),
    file(
      "lefthook.yml",
      "pre-push:\n  commands:\n    guard:\n      run: bash scripts/pre-push.sh\n"
    ),
    file(
      ".pre-commit-config.yaml",
      "repos:\n  - repo: local\n    hooks:\n      - id: guard\n        entry: tools/pre-commit.sh\n"
    ),
    file(".lefthook/pre-commit/check.sh"),
    file(".pi/extensions/guard/README.md", "Runs src/b.ts on every edit."),
    file("scripts/hooks/x.ts", 'import { decide } from "./lib/policy.ts";'),
    file("scripts/hooks/lib/policy.ts"),
    file("scripts/pre-push.sh", "#!/bin/sh\nbun scripts/hooks/push.ts\n"),
    file("scripts/hooks/push.ts", 'import "./lib/push-rules.ts";'),
    file("scripts/hooks/lib/push-rules.ts"),
    ...[
      "tools/stop.sh",
      "tools/guard.sh",
      "tools/guard.ps1",
      "tools/gemini-guard.mjs",
      "tools/opencode.ts",
      "tools/pre-commit.sh",
      ".claude/hooks/stop.sh",
      "tools/unrelated.sh",
      "src/a.ts",
      "src/b.ts",
    ].map((path) => file(path)),
  ];

  const judge = judgeClosure(run, hooks);

  it.each([
    ".codex/hooks.json",
    ".codex/config.toml",
    ".github/hooks/policy.json",
    ".github/copilot/settings.json",
    ".gemini/settings.json",
    ".opencode/plugins/guard.ts",
    ".amp/plugins/guard.ts",
    ".claude/settings.local.json",
    ".lefthook/pre-commit/check.sh",
  ])("%s is a hook config, and judged", (path) => {
    expect(isJudged(judge, path)).toBeTruthy();
  });

  it("judges the scripts each hook command names, what they import and what they run", () => {
    expect(
      [
        "scripts/hooks/x.ts",
        "scripts/hooks/lib/policy.ts",
        "scripts/hooks/push.ts",
        "scripts/hooks/lib/push-rules.ts",
        "tools/stop.sh",
        "tools/guard.sh",
        "tools/guard.ps1",
        "tools/gemini-guard.mjs",
        "tools/opencode.ts",
        "tools/pre-commit.sh",
        ".claude/hooks/stop.sh",
        "scripts/pre-push.sh",
        ".husky/y.mjs",
      ].filter((path) => !isJudged(judge, path))
    ).toStrictEqual([]);
  });

  it("leaves alone files a hook config names outside a command", () => {
    expect(
      ["src/a.ts", "src/b.ts", "tools/unrelated.sh"].filter((path) =>
        isJudged(judge, path)
      )
    ).toStrictEqual([]);
  });
});

describe("the judge closure over workspace and task-runner policy", () => {
  const python: RunBlock = {
    checks: { [LaneName.make("unit")]: Command.make("pytest") },
    setup: Command.make(
      "pip install -r requirements.txt -c constraints.txt && bun install --frozen-lockfile"
    ),
    test: Command.make("pytest {path}"),
  };

  const judge = judgeClosure(python, [
    file("requirements.txt", "pytest==9.0.0\n"),
    file("constraints.txt"),
    file("bun.lock"),
    file("src/a.ts"),
  ]);

  it.each([
    ["bunfig.toml", true],
    ["packages/a/bunfig.toml", true],
    ["pnpm-workspace.yaml", true],
    ["turbo.json", true],
    ["packages/a/turbo.json", true],
    ["oxfmt.config.ts", true],
    [".oxfmtrc.json", true],
    ["biome.jsonc", true],
    [".prettierrc", true],
    ["prettier.config.mjs", true],
    ["nx.json", true],
    [".yarnrc.yml", true],
    ["vitest.e2e.config.ts", true],
    [".editorconfig", false],
    ["bun.lock", false],
    ["pnpm-lock.yaml", false],
    ["requirements.txt", false],
    ["constraints.txt", false],
    ["package.json", false],
    ["src/a.ts", false],
    ["README.md", false],
    [".env.local", false],
  ])("%s is judged: %s", (path, judged) => {
    expect(isJudged(judge, path)).toBe(judged);
  });
});

// The platform reads no file above this size for the closure; here such a
// file keeps its path and is given with empty content.
const MAX_BYTES = 256 * 1024;

/** This repo's tracked files, as `git ls-files` lists them, and its closure. */
class ThisRepo extends Context.Service<
  ThisRepo,
  { readonly closure: JudgeClosure; readonly tracked: readonly string[] }
>()("checks/test/ThisRepo") {}

const thisRepo = Layer.effect(
  ThisRepo,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // Vitest runs in the package's folder, two below the root.
    const root = path.resolve("..", "..");

    const tracked = (yield* gitOk(root, "ls-files", "-z"))
      .split("\0")
      .filter((name) => name !== "");

    const files = yield* Effect.forEach(
      tracked,
      (name) =>
        fs.readFileString(path.join(root, name)).pipe(
          Effect.map((content) =>
            file(name, content.length > MAX_BYTES ? "" : content)
          ),
          Effect.orElseSucceed(() => file(name))
        ),
      { concurrency: 16 }
    );

    const verify: RunBlock = {
      checks: { [LaneName.make("verify")]: Command.make("bun run verify") },
      setup: Command.make("bun install --frozen-lockfile"),
      test: Command.make("bunx vitest run {path}"),
    };

    return { closure: judgeClosure(verify, files), tracked };
  })
).pipe(Layer.provide(NodeServices.layer));

layer(thisRepo, { excludeTestServices: true })(
  "the judge closure of this repo, as the fixture",
  (repo) => {
    repo.effect("holds the lint plugin folders its oxlint config loads", () =>
      Effect.gen(function* () {
        const { closure: judge } = yield* ThisRepo;

        expect(judge.paths).toStrictEqual(
          expect.arrayContaining([
            "tools/oxlint/anti-slop/**",
            "tools/oxlint/fence/**",
          ])
        );
      })
    );

    repo.effect(
      "holds the tsconfig base, the policy files and the hook configs",
      () =>
        Effect.gen(function* () {
          const { closure: judge } = yield* ThisRepo;

          expect(judge.paths).toContain("tsconfig.base.json");
          expect(
            [
              "tsconfig.json",
              "tsconfig.base.json",
              "oxlint.config.ts",
              "oxlint.debt.config.ts",
              "oxfmt.config.ts",
              "turbo.json",
              "bunfig.toml",
              ".claude/settings.json",
              ".cursor/hooks.json",
            ].filter((path) => !isJudged(judge, path))
          ).toStrictEqual([]);
        })
    );

    repo.effect(
      "holds every file of pi's extension, the hook scripts and the fence's fixtures",
      () =>
        Effect.gen(function* () {
          const { closure: judge, tracked } = yield* ThisRepo;

          for (const folder of [
            ".pi/",
            "scripts/hooks/",
            "tools/oxlint/fence/fixtures/",
          ]) {
            const inside = tracked.filter((path) => path.startsWith(folder));

            expect(inside.length).toBeGreaterThan(0);
            expect(
              inside.filter((path) => !isJudged(judge, path))
            ).toStrictEqual([]);
          }
        })
    );

    repo.effect(
      "holds the rule fixture test that imports the fence's rules",
      () =>
        Effect.gen(function* () {
          const { closure: judge } = yield* ThisRepo;

          expect(judge.paths).toContain(
            "packages/config/test/oxlint-fence.test.ts"
          );
        })
    );

    repo.effect(
      "leaves the product's code, the manifest and the lockfile editable",
      () =>
        Effect.gen(function* () {
          const { closure: judge } = yield* ThisRepo;

          expect(
            [
              "package.json",
              "bun.lock",
              "AGENTS.md",
              "packages/checks/src/finder.ts",
              "packages/protocol/src/refusal.ts",
              "apps/platform/src/surfaces.ts",
              "scripts/gen.ts",
            ].filter((path) => isJudged(judge, path))
          ).toStrictEqual([]);
          expect(judge.pointers).toContain("package.json#/scripts");
        })
    );
  }
);

describe(matchGlob, () => {
  it.each([
    [".github/workflows/**", ".github/workflows/ci.yml", true],
    [".github/workflows/**", ".github/workflows/nested/x.yml", true],
    [".github/workflows/**", ".github/ci.yml", false],
    ["**/tsconfig*.json", "tsconfig.json", true],
    ["**/tsconfig*.json", "packages/a/tsconfig.build.json", true],
    ["**/tsconfig*.json", "packages/a/tsconfig.json.bak", false],
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/a/b.ts", false],
    ["src/?.ts", "src/a.ts", true],
    ["src/?.ts", "src/ab.ts", false],
    ["**/.env.*", ".env.production", true],
    ["**/.env.*", "apps/web/.env.schema", true],
    ["*", ".hidden", true],
    ["a/**/b", "a/b", true],
    ["a/**/b", "a/x/y/b", true],
    ["a/**/b", "a/x/y/c", false],
    ["./lefthook.yml", "lefthook.yml", true],
    ["lefthook.yml", "./lefthook.yml", true],
    ["lefthook.yml", "sub/lefthook.yml", false],
    [
      ".agents/skills/*-contribute/**",
      ".agents/skills/x-contribute/SKILL.md",
      true,
    ],
    ["a.b", "axb", false],
    ["(x)[y]+", "(x)[y]+", true],
  ])("%s matches %s: %s", (glob, path, matches) => {
    expect(matchGlob(glob, path)).toBe(matches);
  });
});
