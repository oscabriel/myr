import { describe, expect, it } from "@effect/vitest";
import type { HeldBackResult } from "@repo/protocol/domain/answer";
import { AreaName, SuiteRoot } from "@repo/protocol/ids";
import { expectTypeOf } from "vitest";

import { areaBits } from "../src/held-back-filter.ts";
import type { HeldBackExit } from "../src/held-back-filter.ts";

const suite = SuiteRoot.make(`sha256:${"3f".repeat(32)}`);

const exportArea = AreaName.make("export");

const parser = AreaName.make("parser");

const tz = AreaName.make("tz");

const exit = (
  area: AreaName,
  code: number,
  timedOut = false
): HeldBackExit => ({ area, code, timedOut });

describe(areaBits, () => {
  it("counts each declared area's passing runs of its total, under the suite root, in the declared order", () => {
    expect(
      areaBits({
        areas: [exportArea, parser],
        exits: [exit(parser, 1), exit(exportArea, 0), exit(exportArea, 0)],
        suite,
      })
    ).toStrictEqual([
      { area: "export", passed: 2, suite, total: 2 },
      { area: "parser", passed: 0, suite, total: 1 },
    ]);
  });

  it("counts an assertion failure, a load error and a timeout alike: not passed", () => {
    expect(
      areaBits({
        areas: [parser],
        exits: [
          exit(parser, 1),
          exit(parser, 2),
          exit(parser, -1, true),
          // It exited 0 as the time limit hit: still a timeout.
          exit(parser, 0, true),
          exit(parser, 0),
        ],
        suite,
      })
    ).toStrictEqual([{ area: "parser", passed: 1, suite, total: 5 }]);
  });

  it("reports every declared area, one with no runs as 0 of 0, and none it did not declare", () => {
    expect(
      areaBits({
        areas: [exportArea, tz],
        exits: [exit(exportArea, 0), exit(parser, 1)],
        suite,
      })
    ).toStrictEqual([
      { area: "export", passed: 1, suite, total: 1 },
      { area: "tz", passed: 0, suite, total: 0 },
    ]);
  });

  it("reports an area declared twice once", () => {
    expect(
      areaBits({
        areas: [exportArea, exportArea],
        exits: [exit(exportArea, 0)],
        suite,
      })
    ).toStrictEqual([{ area: "export", passed: 1, suite, total: 1 }]);
  });

  it("returns a type with a field for nothing but the area, its counts and the suite", () => {
    expectTypeOf(areaBits).returns.toEqualTypeOf<readonly HeldBackResult[]>();
    expectTypeOf<keyof HeldBackResult>().toEqualTypeOf<
      "area" | "passed" | "suite" | "total"
    >();
    // What it reads of a run is how it ended, never what it printed.
    expectTypeOf<keyof HeldBackExit>().toEqualTypeOf<
      "area" | "code" | "timedOut"
    >();
  });
});
