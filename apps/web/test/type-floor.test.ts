import { describe, expect, it } from "@effect/vitest";

const sources: Readonly<Record<string, string>> = import.meta.glob(
  "../src/**/*.{ts,tsx}",
  { eager: true, import: "default", query: "?raw" }
);

const sizeClass =
  /(?<![\w-])text-(?:xs|\[(?<size>\d*\.?\d+)(?<unit>px|rem)\])(?![\w-])/gu;

const FLOOR = 13;

const offending = (source: string) =>
  [...source.matchAll(sizeClass)].flatMap((match) => {
    const { size, unit } = match.groups ?? {};

    if (size === undefined || unit === undefined) {
      return [match[0]];
    }

    const px = unit === "rem" ? Number(size) * 16 : Number(size);

    // 13 px as an arbitrary value is the mono step under another name.
    return px <= FLOOR ? [match[0]] : [];
  });

describe("the type floor", () => {
  it("reads every source file of the web", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it("sets nothing under 13 px, and names the mono step by its token", () => {
    const found = Object.entries(sources).flatMap(([path, source]) => {
      const classes = offending(source);

      return classes.length === 0 ? [] : [`${path}: ${classes.join(", ")}`];
    });

    expect(found).toStrictEqual([]);
  });

  it("catches each size the floor refuses", () => {
    expect(
      offending(
        "a text-xs b sm:text-xs c text-[0.6875rem] d text-[0.75rem] e text-[11px] f text-[12px] g text-[0.8125rem] h text-[13px]"
      )
    ).toStrictEqual([
      "text-xs",
      "text-xs",
      "text-[0.6875rem]",
      "text-[0.75rem]",
      "text-[11px]",
      "text-[12px]",
      "text-[0.8125rem]",
      "text-[13px]",
    ]);

    expect(
      offending("text-mono text-ui text-label text-[0.875rem] text-xsmall")
    ).toStrictEqual([]);
  });
});
