/**
 * Fixture repos for the command finder, as the in-memory file lists the
 * platform reads at a landed commit. Each one is shaped like a real project's
 * CI, hook and script files.
 */
import type { RepoFile } from "../../../src/finder.ts";

const file = (path: string, ...lines: readonly string[]): RepoFile => ({
  content: `${lines.join("\n")}\n`,
  path,
});

/** A Bun workspace whose GitHub workflow installs, lints and tests. */
export const bunWorkspace: readonly RepoFile[] = [
  file(
    "package.json",
    "{",
    '  "name": "parsekit",',
    '  "private": true,',
    '  "workspaces": ["packages/*"],',
    '  "scripts": {',
    '    "dev": "vite",',
    '    "lint": "oxlint",',
    '    "typecheck": "tsc --noEmit",',
    '    "test": "vitest run"',
    "  }",
    "}"
  ),
  file(
    "packages/parse/package.json",
    "{",
    '  "name": "@parsekit/parse",',
    '  "scripts": { "test": "vitest run" }',
    "}"
  ),
  file(
    ".github/workflows/ci.yml",
    "name: CI",
    "on:",
    "  pull_request:",
    "  push:",
    "    branches: [main]",
    "jobs:",
    "  check:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: oven-sh/setup-bun@v2",
    "      - run: bun install --frozen-lockfile",
    "      - name: Lint",
    "        run: bun run lint",
    "      - name: Test",
    "        run: bun run test"
  ),
  file("src/index.ts", "export const parse = (text: string) => text;"),
];

/** A pnpm library on Forgejo, with lefthook running lint and types before a commit. */
export const forgejoLefthook: readonly RepoFile[] = [
  file(
    "package.json",
    "{",
    '  "name": "tidy-dates",',
    '  "packageManager": "pnpm@9.12.0",',
    '  "scripts": {',
    '    "build": "tsc -p tsconfig.build.json",',
    '    "test": "jest"',
    "  }",
    "}"
  ),
  file(
    ".forgejo/workflows/test.yml",
    "on: [push, pull_request]",
    "jobs:",
    "  test:",
    "    runs-on: docker",
    "    container:",
    "      image: node:22",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - run: corepack enable",
    "      - run: pnpm install --frozen-lockfile",
    "      - run: pnpm test"
  ),
  file(
    "lefthook.yml",
    "pre-commit:",
    "  parallel: true",
    "  commands:",
    "    lint:",
    '      glob: "*.{js,ts}"',
    "      run: pnpm exec eslint {staged_files}",
    "    types:",
    "      run: pnpm exec tsc --noEmit",
    "pre-push:",
    "  commands:",
    "    test:",
    "      run: pnpm test"
  ),
];

/** An npm package with husky hooks and no CI. */
export const huskyOnly: readonly RepoFile[] = [
  file(
    "package.json",
    "{",
    '  "name": "slugger",',
    '  "scripts": {',
    '    "prepare": "husky",',
    '    "test": "jest"',
    "  },",
    '  "lint-staged": { "*.js": "eslint --fix" }',
    "}"
  ),
  file("package-lock.json", "{}"),
  file(".husky/pre-commit", "npx lint-staged", "npm test"),
  file(".husky/_/husky.sh", "#!/usr/bin/env sh", "exit 0"),
];

/** A Python project: pre-commit runs ruff and mypy, and the workflow runs pytest. */
export const python: readonly RepoFile[] = [
  file(
    ".pre-commit-config.yaml",
    "repos:",
    "  - repo: https://github.com/astral-sh/ruff-pre-commit",
    "    rev: v0.6.9",
    "    hooks:",
    "      - id: ruff",
    "        args: [--fix]",
    "      - id: ruff-format",
    "  - repo: https://github.com/pre-commit/mirrors-mypy",
    "    rev: v1.11.2",
    "    hooks:",
    "      - id: mypy"
  ),
  file(
    ".github/workflows/test.yml",
    "on: [push, pull_request]",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    strategy:",
    "      matrix:",
    '        python-version: ["3.11", "3.12"]',
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-python@v5",
    "        with:",
    `          python-version: \${{ matrix.python-version }}`,
    "      - run: |",
    "          python -m pip install --upgrade pip",
    '          pip install -e ".[dev]"',
    "      - run: pytest"
  ),
  file("pyproject.toml", "[project]", 'name = "fossil"'),
];

/** A repo with nothing the finder reads. */
export const nothing: readonly RepoFile[] = [
  file("README.md", "# wrec"),
  file("src/main.zig", "pub fn main() void {}"),
];

/** A broken workflow beside a good one: the broken one is skipped, not thrown. */
export const brokenWorkflow: readonly RepoFile[] = [
  file(".github/workflows/bad.yml", "jobs: [unclosed", "  steps: {"),
  file(".github/workflows/shape.yml", "jobs: just a string"),
  file(
    ".github/workflows/good.yml",
    "jobs:",
    "  test:",
    "    steps:",
    "      - run: go test ./..."
  ),
];

/** A fence-shaped monorepo with no CI: its root scripts are its gate, run by turbo. */
export const turboMonorepo: readonly RepoFile[] = [
  file(
    "package.json",
    JSON.stringify({
      scripts: {
        check: "oxlint && oxfmt --check .",
        dev: "vitest",
        fix: "oxlint --fix && oxfmt .",
        test: "turbo run test",
        typecheck: "turbo run typecheck",
      },
    })
  ),
  file("bun.lock", "{}"),
  file(
    "packages/parse/package.json",
    JSON.stringify({ scripts: { test: "vitest run" } })
  ),
];

/**
 * A workflow that runs a fixer, a deploy that builds first, a dev server, an
 * unknown script and both kinds of `ruff format`.
 */
export const mixedWorkflow: readonly RepoFile[] = [
  file(
    "package.json",
    JSON.stringify({
      scripts: {
        deploy: "vite build && wrangler deploy",
        dev: "vitest",
        "schema:check": "node scripts/schema.js --check",
      },
    })
  ),
  file(
    ".github/workflows/ci.yml",
    "jobs:",
    "  ci:",
    "    steps:",
    "      - run: npm ci",
    "      - run: npx prettier --write .",
    "      - run: npm run schema:check",
    "      - run: npm run deploy",
    "      - run: npm run dev",
    "      - run: ruff format .",
    "      - run: ruff format --check .",
    "      - run: echo done"
  ),
];
