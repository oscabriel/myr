import { describe, expect, it } from "@effect/vitest";

import { matchAny, matchGlob } from "../src/glob.ts";

const rows: readonly (readonly [string, string, boolean])[] = [
  ["vitest.config.*", "vitest.config.ts", true],
  ["vitest.config.*", "packages/parse/vitest.config.ts", true],
  [".github/workflows/**", ".github/workflows/ci.yml", true],
  [".github/workflows/**", "docs/.github/workflows/ci.yml", false],
  ["/package.json", "package.json", true],
  ["/package.json", "packages/parse/package.json", false],
  ["tools/oxlint/**", "tools/oxlint", true],
  ["packages/*/src/**", "packages/parse/src/week.ts", true],
  ["packages/*/src/**", "packages/parse/test/week.test.ts", false],
  ["a/**/b", "a/b", true],
  ["a/**/b", "a/x/y/b", true],
  ["tsconfig*.json", "packages/parse/tsconfig.build.json", true],
  ["generated/", "generated/skill.md", true],
  ["generated/", "packages/parse/generated/skill.md", true],
  ["generated/", "packages/parse/generated.ts", false],
  ["docs/generated/", "docs/generated/skill.md", true],
  ["docs/generated/", "packages/docs/generated/skill.md", false],
];

describe(matchGlob, () => {
  it.each(rows)("%s against %s is %s", (glob, path, matches) => {
    expect(matchGlob(glob, path)).toBe(matches);
  });
});

describe(matchAny, () => {
  it("takes back out what a !glob names", () => {
    const env = [".env.*", "!.env.*.local"];

    expect([
      matchAny(env, ".env.production"),
      matchAny(env, "apps/web/.env.production.local"),
    ]).toStrictEqual([true, false]);
  });
});
