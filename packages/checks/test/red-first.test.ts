import { describe, expect, it } from "@effect/vitest";
import { LaneName } from "@repo/protocol/ids";
import { NotRedFirst, WeakCheck } from "@repo/protocol/refusal";
import { Result } from "effect";

import type { CheckRun } from "../src/check-runner.ts";
import type { RunExit } from "../src/classify.ts";
import { redFirst, redFirstOfRuns } from "../src/red-first.ts";
import bunAssertion from "./fixtures/runs/bun-assertion.json" with { type: "json" };
import vitestAssertionOther from "./fixtures/runs/vitest-assertion-other.json" with { type: "json" };
import vitestAssertion from "./fixtures/runs/vitest-assertion.json" with { type: "json" };
import vitestLoadError from "./fixtures/runs/vitest-load-error.json" with { type: "json" };
import vitestNoTests from "./fixtures/runs/vitest-no-tests.json" with { type: "json" };

const unit = LaneName.make("unit");

const onUnit = (exit: RunExit) => ({ exit, lane: unit });

const passed: RunExit = { code: 0, stderr: "", stdout: " 1 pass\n 0 fail" };

const notRedFirst = Result.fail(new NotRedFirst({}));

// What the platform sees of a run: lanes and evidence, never the output.
const checkRun = (
  result: CheckRun["lanes"][number]["result"],
  evidence: Omit<CheckRun["evidence"][number], "lane">
): CheckRun => ({
  durationMs: 40,
  evidence: result === "passed" ? [] : [{ lane: unit, ...evidence }],
  heldBack: [],
  lanes: [{ command: "bun run test", durationMs: 40, lane: unit, result }],
});

describe(redFirst, () => {
  it("holds for two runs failing on the same assertion in the same test", () => {
    expect(
      redFirst([onUnit(vitestAssertion), onUnit(vitestAssertion)])
    ).toStrictEqual(
      Result.succeed({
        lane: unit,
        signature:
          "parseWeek reads the first week of a year: AssertionError: expected { week: +0, year: 2026 } to strictly equal { week: 1, year: 2026 }",
      })
    );
  });

  it("holds from the output alone, with no report", () => {
    expect(
      redFirst([onUnit(bunAssertion), onUnit(bunAssertion)])
    ).toStrictEqual(
      Result.succeed({
        lane: unit,
        signature:
          "weekOf > reads the first week of a year: error: expect(received).toBe(expected) Expected: 1 Received: 0",
      })
    );
  });

  it("is NotRedFirst for one assertion failure and one load error", () => {
    expect(
      redFirst([onUnit(vitestAssertion), onUnit(vitestLoadError)])
    ).toStrictEqual(notRedFirst);
  });

  it("is NotRedFirst for two load errors: the check fails before it asserts", () => {
    expect(
      redFirst([onUnit(vitestLoadError), onUnit(vitestLoadError)])
    ).toStrictEqual(notRedFirst);
  });

  it("is NotRedFirst for two passes", () => {
    expect(redFirst([onUnit(passed), onUnit(passed)])).toStrictEqual(
      notRedFirst
    );
  });

  it("is NotRedFirst for two failures on different assertions: a flaky check is not red first", () => {
    expect(
      redFirst([onUnit(vitestAssertion), onUnit(vitestAssertionOther)])
    ).toStrictEqual(notRedFirst);
  });

  it("is NotRedFirst for two failures that threw rather than asserted", () => {
    const threw: RunExit = {
      code: 1,
      stderr:
        "TypeError: weekOf is not a function\n(fail) weekOf > reads the first week of a year [0.40ms]",
      stdout: "",
    };

    expect(redFirst([onUnit(threw), onUnit(threw)])).toStrictEqual(notRedFirst);
  });

  it("is WeakCheck no assertion when a run found no tests", () => {
    expect(
      redFirst([onUnit(vitestNoTests), onUnit(vitestNoTests)])
    ).toStrictEqual(Result.fail(new WeakCheck({ weakness: "no assertion" })));
  });
});

describe(redFirstOfRuns, () => {
  const signature = "parseWeek reads the first week of a year: expected 0";

  it("holds for two runs whose lane failed with the same signature", () => {
    expect(
      redFirstOfRuns(
        [checkRun("failed", { signature }), checkRun("failed", { signature })],
        unit
      )
    ).toStrictEqual(Result.succeed({ lane: unit, signature }));
  });

  it("is NotRedFirst when the signatures differ", () => {
    expect(
      redFirstOfRuns(
        [
          checkRun("failed", { signature }),
          checkRun("failed", { signature: `${signature} but 2` }),
        ],
        unit
      )
    ).toStrictEqual(notRedFirst);
  });

  it("is NotRedFirst when a run failed with no signature, or passed", () => {
    expect(
      redFirstOfRuns(
        [checkRun("failed", { signature }), checkRun("loadError", {})],
        unit
      )
    ).toStrictEqual(notRedFirst);
    expect(
      redFirstOfRuns([checkRun("passed", {}), checkRun("passed", {})], unit)
    ).toStrictEqual(notRedFirst);
  });

  it("is NotRedFirst when a run has no such lane", () => {
    expect(
      redFirstOfRuns(
        [checkRun("failed", { signature }), checkRun("failed", { signature })],
        LaneName.make("ask")
      )
    ).toStrictEqual(notRedFirst);
  });

  it("is WeakCheck no assertion when a run found no tests", () => {
    expect(
      redFirstOfRuns(
        [
          checkRun("loadError", { weakness: "no assertion" }),
          checkRun("loadError", { weakness: "no assertion" }),
        ],
        unit
      )
    ).toStrictEqual(Result.fail(new WeakCheck({ weakness: "no assertion" })));
  });
});
