import { describe, expect, it } from "@effect/vitest";

/**
 * A page shows what it is about, never the CLI commands that would do it from
 * a terminal. The CLI's own pages name its commands: Install, the landing's
 * install line and transcript, and an ask's Markdown, which an agent reads.
 */
const NAMES_THE_CLI = new Set([
  "../src/features/agents/catalog.ts",
  "../src/features/agents/install-page.tsx",
  "../src/features/ask/markdown.ts",
  "../src/features/landing/landing-page.tsx",
  "../src/features/landing/transcript.ts",
  "../src/features/landing/ways-in.tsx",
]);

/** A command box shows only an install line or a git clone. */
const DRAWS_A_COMMAND = new Set([
  "../src/features/agents/install-page.tsx",
  "../src/features/code/code-bar.tsx",
  "../src/features/landing/landing-page.tsx",
  "../src/features/project/project-header.tsx",
  "../src/features/shared/command.tsx",
]);

describe("the web's pages", () => {
  // Keys only: the sources as text.
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    ["../src/features/**/*.{ts,tsx}", "../src/routes/**/*.{ts,tsx}"],
    { eager: true, import: "default", query: "?raw" }
  );

  const files = (test: (source: string) => boolean) =>
    Object.entries(sources).flatMap(([file, source]) =>
      test(source) ? [file] : []
    );

  it("name the CLI only on its own pages", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(
      files((source) => /Brand\.cli\b/u.test(source)).filter(
        (file) => !NAMES_THE_CLI.has(file)
      )
    ).toStrictEqual([]);
  });

  it("draw a command box only for an install line or a git clone", () => {
    expect(
      files((source) => /\bCommandLine\b/u.test(source)).filter(
        (file) => !DRAWS_A_COMMAND.has(file)
      )
    ).toStrictEqual([]);
  });
});
