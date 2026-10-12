import { describe, expect, it } from "@effect/vitest";

const routeSources: Readonly<Record<string, string>> = import.meta.glob(
  "../src/routes/**/*.{ts,tsx}",
  { eager: true, import: "default", query: "?raw" }
);

describe("the landing's route", () => {
  it("is the only route drawn outside the shell", () => {
    expect(
      Object.entries(routeSources)
        .filter(([, source]) => /shell:\s*"bare"/u.test(source))
        .map(([path]) => path)
    ).toStrictEqual(["../src/routes/index.tsx"]);
  });
});
