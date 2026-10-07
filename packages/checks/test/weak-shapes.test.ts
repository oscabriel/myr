import { describe, expect, it } from "@effect/vitest";

import { weaknessesOf } from "../src/weak-shapes.ts";

// The check files are datekit's, held as text: the lint reads source, never
// runs it.
const territory = ["packages/week/src/**"];

const check = (imports: string, body: string) =>
  `${imports}
import { describe, expect, it, vi } from "vitest";

describe("parseWeek", () => {
  it("reads the first week of a year", () => {
${body}
  });
});
`;

const fromTerritory = `import { onWeek, parseWeek } from "../src/week.ts";`;

describe(weaknessesOf, () => {
  it("passes a real assertion over a territory import", () => {
    expect(
      weaknessesOf(
        check(
          fromTerritory,
          `expect(parseWeek("2026-W01")).toStrictEqual({ week: 1, year: 2026 });`
        ),
        territory
      )
    ).toStrictEqual([]);
  });

  it("passes a territory import by package name", () => {
    expect(
      weaknessesOf(
        check(
          `import { parseWeek } from "@datekit/week";`,
          `expect(parseWeek("2026-W01").week).toBe(1);`
        ),
        territory
      )
    ).toStrictEqual([]);
  });

  it("passes a check with one real assertion among weak ones", () => {
    expect(
      weaknessesOf(
        check(
          fromTerritory,
          `expect(1).toBe(1);
    expect(() => parseWeek("2026-W01")).not.toThrow();
    expect(parseWeek("2026-W01").week).toBe(1);`
        ),
        territory
      )
    ).toStrictEqual([]);
  });

  it("flags self-referential: the check imports nothing from the territory", () => {
    expect(
      weaknessesOf(
        check(
          `import { weeksIn } from "../../calendar/src/year.ts";`,
          `const parseWeek = (text: string) => ({ week: Number(text.slice(6)) });
    expect(parseWeek("2026-W01")).toStrictEqual({ week: 1 });`
        ),
        territory
      )
    ).toStrictEqual(["self-referential"]);
  });

  it("flags constant pin: every expectation is on a literal", () => {
    expect(
      weaknessesOf(
        check(
          fromTerritory,
          `parseWeek("2026-W01");
    expect(1).toBe(1);
    expect("week").toStrictEqual("week");
    expect({ week: 1 }).toStrictEqual({ week: 1 });`
        ),
        territory
      )
    ).toStrictEqual(["constant pin"]);
  });

  it("flags absence-only: every expectation is that nothing happened", () => {
    expect(
      weaknessesOf(
        check(
          fromTerritory,
          `expect(() => parseWeek("2026-W01")).not.toThrow();
    expect(parseWeek("")).toBeUndefined();
    expect(parseWeek("2026-W54")).toBeFalsy();`
        ),
        territory
      )
    ).toStrictEqual(["absence-only"]);
  });

  it("flags mock-only: every expectation is on a vi.fn()", () => {
    expect(
      weaknessesOf(
        check(
          fromTerritory,
          `const listener = vi.fn();
    onWeek(listener);
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls.length).toBe(1);`
        ),
        territory
      )
    ).toStrictEqual(["mock-only"]);
  });

  it("flags fixture-asserts-fixture: expected and actual come from the same fixture", () => {
    expect(
      weaknessesOf(
        check(
          `${fromTerritory}
import fixture from "./fixtures/first-week.json";`,
          `parseWeek(fixture.text);
    expect(fixture.parsed).toStrictEqual(fixture.expected);`
        ),
        territory
      )
    ).toStrictEqual(["fixture-asserts-fixture"]);
  });

  it("flags a check that recomputes its expected value the way the code does", () => {
    expect(
      weaknessesOf(
        check(
          fromTerritory,
          `expect(parseWeek("2026-W01")).toStrictEqual(parseWeek("2026-W01"));`
        ),
        territory
      )
    ).toStrictEqual(["fixture-asserts-fixture"]);
  });

  it("ignores expectations inside comments and strings", () => {
    expect(
      weaknessesOf(
        check(
          fromTerritory,
          `// expect(1).toBe(1);
    /* expect(listener).toHaveBeenCalled(); */
    const note = "expect(0).toBeFalsy()";
    expect(parseWeek(note).week).toBe(1);`
        ),
        territory
      )
    ).toStrictEqual([]);
  });

  it("flags nothing in a file it cannot read: no expect calls", () => {
    expect(
      weaknessesOf(
        `from datekit.week import parse_week

def test_first_week():
    assert parse_week("2026-W01") == (2026, 1)
`,
        territory
      )
    ).toStrictEqual([]);
  });
});
