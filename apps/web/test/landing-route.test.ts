import { describe, expect, it } from "@effect/vitest";

import { Route } from "../src/routes/index.tsx";

const routeSources: Readonly<Record<string, string>> = import.meta.glob(
  "../src/routes/**/*.{ts,tsx}",
  { eager: true, import: "default", query: "?raw" }
);

describe("the landing's route", () => {
  // ADR 0041 amends ADR 0030: the landing is drawn in the site shell, its top bar and footer the site's.
  it("is drawn in the site shell", () => {
    expect(Route.options.staticData?.shell).toBe("site");
  });

  it("leaves no route drawn outside the shells", () => {
    expect(
      Object.entries(routeSources)
        .filter(([, source]) => /shell:\s*"bare"/u.test(source))
        .map(([path]) => path)
    ).toStrictEqual([]);
  });
});
