import { describe, expect, it } from "@effect/vitest";

import { findRunBlock } from "../src/finder.ts";
import {
  brokenWorkflow,
  bunWorkspace,
  turboMonorepo,
  forgejoLefthook,
  huskyOnly,
  mixedWorkflow,
  nothing,
  python,
} from "./fixtures/finder/repos.ts";

describe(findRunBlock, () => {
  it("finds a Bun workspace's setup, one-file test and lanes from its workflow and scripts", () => {
    expect(findRunBlock(bunWorkspace)).toStrictEqual({
      run: {
        checks: {
          lint: "bun run lint",
          types: "bun run typecheck",
          unit: "bun run test",
        },
        setup: "bun install --frozen-lockfile",
        test: "vitest run {path}",
      },
      sources: [
        "setup from .github/workflows/ci.yml",
        "test from package.json",
        "checks.lint from .github/workflows/ci.yml",
        "checks.unit from .github/workflows/ci.yml",
        "checks.types from package.json",
      ],
    });
  });

  it("reads a Forgejo workflow first, then lefthook's commands, then the scripts", () => {
    expect(findRunBlock(forgejoLefthook)).toStrictEqual({
      run: {
        checks: {
          build: "pnpm run build",
          lint: "pnpm exec eslint .",
          types: "pnpm exec tsc --noEmit",
          unit: "pnpm test",
        },
        setup: "corepack enable && pnpm install --frozen-lockfile",
        test: "jest {path}",
      },
      sources: [
        "setup from .forgejo/workflows/test.yml",
        "test from package.json",
        "checks.unit from .forgejo/workflows/test.yml",
        "checks.lint from lefthook.yml",
        "checks.types from lefthook.yml",
        "checks.build from package.json",
      ],
    });
  });

  it("reads husky hooks, leaves lint-staged out, and infers setup from the lockfile", () => {
    expect(findRunBlock(huskyOnly)).toStrictEqual({
      run: {
        checks: { unit: "npm test" },
        setup: "npm ci",
        test: "jest {path}",
      },
      sources: [
        "setup inferred from package-lock.json",
        "test from package.json",
        "checks.unit from .husky/pre-commit",
      ],
    });
  });

  it("finds a Python project's pytest from its workflow and its lint and types from pre-commit", () => {
    expect(findRunBlock(python)).toStrictEqual({
      run: {
        checks: {
          format: "pre-commit run ruff-format --all-files",
          lint: "pre-commit run ruff --all-files",
          types: "pre-commit run mypy --all-files",
          unit: "pytest",
        },
        setup:
          'python -m pip install --upgrade pip && pip install -e ".[dev]" && pre-commit install-hooks',
        test: "pytest {path}",
      },
      sources: [
        "setup from .github/workflows/test.yml",
        "setup from .pre-commit-config.yaml",
        "test from .github/workflows/test.yml",
        "checks.unit from .github/workflows/test.yml",
        "checks.lint from .pre-commit-config.yaml",
        "checks.format from .pre-commit-config.yaml",
        "checks.types from .pre-commit-config.yaml",
      ],
    });
  });

  it("takes a repo's checking scripts as lanes when it has no CI, and leaves fixers and dev servers out", () => {
    expect(findRunBlock(turboMonorepo)).toStrictEqual({
      run: {
        checks: {
          lint: "bun run check",
          types: "bun run typecheck",
          unit: "bun run test",
        },
        setup: "bun install --frozen-lockfile",
        test: "bun run test",
      },
      sources: [
        "setup inferred from bun.lock",
        "test from package.json",
        "checks.lint from package.json",
        "checks.unit from package.json",
        "checks.types from package.json",
      ],
    });
  });

  it("names a lane by its script when the tool is unknown, and never takes a fixer or a deploy", () => {
    expect(findRunBlock(mixedWorkflow)).toStrictEqual({
      run: {
        checks: {
          format: "ruff format --check .",
          "gen-check": "npm run gen:check",
        },
        setup: "npm ci",
      },
      sources: [
        "setup from .github/workflows/ci.yml",
        "checks.gen-check from .github/workflows/ci.yml",
        "checks.format from .github/workflows/ci.yml",
      ],
    });
  });

  it("finds nothing in a repo with no scripts, CI or hooks", () => {
    expect(findRunBlock(nothing)).toStrictEqual({ run: {}, sources: [] });
  });

  it("skips a workflow it can't read, with the reason, and keeps the rest", () => {
    const found = findRunBlock(brokenWorkflow);

    expect(found.run).toStrictEqual({
      checks: { unit: "go test ./..." },
      test: 'go test "./$(dirname {path})"',
    });
    expect(found.sources).toHaveLength(4);
    expect(found.sources.slice(0, 2)).toStrictEqual([
      "test from .github/workflows/good.yml",
      "checks.unit from .github/workflows/good.yml",
    ]);
    expect(found.sources[2]).toMatch(
      /^skipped \.github\/workflows\/bad\.yml: \S/u
    );
    expect(found.sources[3]).toMatch(
      /^skipped \.github\/workflows\/shape\.yml: \S/u
    );
  });

  it.each([
    ["npx vitest", "npx vitest run {path}"],
    ["bunx vitest run --reporter=dot", "bunx vitest run --reporter=dot {path}"],
    ["npx jest --ci", "npx jest --ci {path}"],
    ["bun test", "bun test {path}"],
    ["uv run pytest -q", "uv run pytest -q {path}"],
    ["python -m pytest", "python -m pytest {path}"],
    ["go test -race ./...", 'go test -race "./$(dirname {path})"'],
    [
      "cargo test --all-features",
      'cargo test --all-features --test "$(basename {path} .rs)"',
    ],
    ["make test", "make test"],
  ])("turns the test command %s into %s", (command, test) => {
    const found = findRunBlock([
      {
        content: `jobs:\n  test:\n    steps:\n      - run: ${command}\n`,
        path: ".github/workflows/test.yml",
      },
    ]);

    expect(found.run).toStrictEqual({ checks: { unit: command }, test });
  });
});
