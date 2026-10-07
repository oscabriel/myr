import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Command } from "@repo/protocol/domain/common";
import type { RunBlock } from "@repo/protocol/domain/run";
import { LaneName } from "@repo/protocol/ids";

import type { RepoFile } from "../src/finder.ts";
import {
  defaultJudgeGlobs,
  isJudged,
  judgeClosure,
  matchGlob,
  touchedPointers,
} from "../src/judge.ts";

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
