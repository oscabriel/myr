import { describe, expect, it } from "@effect/vitest";
import { LaneName } from "@repo/protocol/ids";
import { Option } from "effect";

import { classifyRun, failureSignature } from "../src/classify.ts";
import type { RunExit } from "../src/classify.ts";
import bunAssertion from "./fixtures/runs/bun-assertion.json" with { type: "json" };
import bunLoadError from "./fixtures/runs/bun-load-error.json" with { type: "json" };
import bunNoTests from "./fixtures/runs/bun-no-tests.json" with { type: "json" };
import nodeSyntaxError from "./fixtures/runs/node-syntax-error.json" with { type: "json" };
import vitestAssertion from "./fixtures/runs/vitest-assertion.json" with { type: "json" };
import vitestLoadError from "./fixtures/runs/vitest-load-error.json" with { type: "json" };
import vitestNoTests from "./fixtures/runs/vitest-no-tests.json" with { type: "json" };

const unit = LaneName.make("unit");

// pytest is not installed here, so this run is written out by hand in
// pytest 8's plain-`assert` failure format, not recorded.
const pytestAssertion = (path: string, address: string, seconds: string) => ({
  code: 1,
  stderr: "",
  stdout: [
    "============================= test session starts ==============================",
    `rootdir: ${path}`,
    "collected 1 item",
    "",
    "test_week.py F                                                           [100%]",
    "",
    "=================================== FAILURES ===================================",
    "_______________________________ test_first_week ________________________________",
    "",
    "    def test_first_week():",
    '>       assert week_of("2026-W01") == 1',
    `E       assert 0 == 1`,
    `E        +  where 0 = week_of(<datekit.Week object at ${address}>)`,
    "",
    `${path}/test_week.py:5: AssertionError`,
    "=========================== short test summary info ============================",
    "FAILED test_week.py::test_first_week - assert 0 == 1",
    `============================== 1 failed in ${seconds} ===============================`,
  ].join("\n"),
});

// vitest before 4 reported a missing import this way; 5 says "Cannot find module".
const failedToLoadUrl: RunExit = {
  code: 1,
  stderr:
    "Error: Failed to load url ../src/week.ts (resolved id: ../src/week.ts) in /work/datekit/test/week.test.ts. Does the file exist?",
  stdout: " Test Files  1 failed (1)\n      Tests  no tests",
};

const exit = (path: string, ms: string, address: string): RunExit => ({
  code: 1,
  stderr: `(fail) parses [${ms}]\nAssertionError: ${path}/week.ts took ${ms} at ${address}`,
  stdout: "",
});

const withoutReport = ({ code, stderr, stdout }: RunExit): RunExit => ({
  code,
  stderr,
  stdout,
});

describe(classifyRun, () => {
  describe("with vitest's JSON report", () => {
    it("is failed when a test fails on an assertion", () => {
      expect(classifyRun(unit, vitestAssertion)).toBe("failed");
    });

    it("is loadError when the test file fails to load", () => {
      expect(classifyRun(unit, vitestLoadError)).toBe("loadError");
    });

    it("is loadError when no test file is found", () => {
      expect(classifyRun(unit, vitestNoTests)).toBe("loadError");
    });

    it("is passed on exit 0, even when the report found no tests", () => {
      expect(classifyRun(unit, { ...vitestNoTests, code: 0 })).toBe("passed");
    });
  });

  describe("from vitest's output, with the report left out", () => {
    it("is failed on an assertion", () => {
      expect(classifyRun(unit, withoutReport(vitestAssertion))).toBe("failed");
      expect(failureSignature(withoutReport(vitestAssertion))).toStrictEqual(
        Option.some(
          "test/week.test.js > parseWeek > reads the first week of a year: AssertionError: expected { week: +0, year: 2026 } to strictly equal { week: 1, year: 2026 }"
        )
      );
    });

    it("is loadError when the test file fails to load, or none is found", () => {
      expect(classifyRun(unit, withoutReport(vitestLoadError))).toBe(
        "loadError"
      );
      expect(classifyRun(unit, withoutReport(vitestNoTests))).toBe("loadError");
    });
  });

  describe("from the output, when there is no report", () => {
    it("is failed on bun's expect(...).toBe failure", () => {
      expect(classifyRun(unit, bunAssertion)).toBe("failed");
    });

    it("is failed on pytest's AssertionError", () => {
      expect(
        classifyRun(unit, pytestAssertion("/work/datekit", "0x7f3a", "0.02s"))
      ).toBe("failed");
    });

    it("is loadError on a SyntaxError", () => {
      expect(classifyRun(unit, nodeSyntaxError)).toBe("loadError");
    });

    it("is loadError on Cannot find module", () => {
      expect(classifyRun(unit, bunLoadError)).toBe("loadError");
    });

    it("is loadError on Failed to load url", () => {
      expect(classifyRun(unit, failedToLoadUrl)).toBe("loadError");
    });

    it("is loadError when bun finds no test files", () => {
      expect(classifyRun(unit, bunNoTests)).toBe("loadError");
    });

    it("is failed when a nonzero exit says nothing more", () => {
      expect(
        classifyRun(LaneName.make("lint"), {
          code: 1,
          stderr: "",
          stdout: "Found 3 warnings and 2 errors.",
        })
      ).toBe("failed");
    });
  });

  it("is passed on exit 0", () => {
    expect(
      classifyRun(unit, { code: 0, stderr: "", stdout: "1 pass\n0 fail" })
    ).toBe("passed");
  });

  it("is blocked when the runner was killed at the time limit", () => {
    expect(
      classifyRun(unit, {
        code: 1,
        stderr: "",
        stdout: "AssertionError: expected 0 to be 1",
        timedOut: true,
      })
    ).toBe("blocked");
  });

  it("is blocked when the lane's command could not start", () => {
    expect(
      classifyRun(unit, {
        code: 127,
        stderr: "sh: 1: vitest: not found",
        stdout: "",
      })
    ).toBe("blocked");
  });
});

describe(failureSignature, () => {
  it("names the failing test and the first line of its assertion, from the report", () => {
    expect(failureSignature(vitestAssertion)).toStrictEqual(
      Option.some(
        "parseWeek reads the first week of a year: AssertionError: expected { week: +0, year: 2026 } to strictly equal { week: 1, year: 2026 }"
      )
    );
  });

  it("names the failing test and its expectation, from bun's output", () => {
    expect(failureSignature(bunAssertion)).toStrictEqual(
      Option.some(
        "weekOf > reads the first week of a year: error: expect(received).toBe(expected) Expected: 1 Received: 0"
      )
    );
  });

  it("names the failing test and its assertion, from pytest's output", () => {
    expect(
      failureSignature(pytestAssertion("/work/datekit", "0x7f3a", "0.02s"))
    ).toStrictEqual(
      Option.some("test_week.py::test_first_week: E assert 0 == 1")
    );
  });

  it("is the same for two runs that differ only in paths, durations and addresses", () => {
    const first = failureSignature(
      pytestAssertion("/home/ci/a", "0x7f3a2c", "0.02s")
    );

    const second = failureSignature(
      pytestAssertion("/tmp/run-9/b", "0x55d0e1", "1.31s")
    );

    expect(first).toStrictEqual(
      Option.some("test_week.py::test_first_week: E assert 0 == 1")
    );
    expect(second).toStrictEqual(first);
  });

  it("strips durations, absolute paths and addresses from the assertion line", () => {
    const first = failureSignature(
      exit("/home/ci/datekit", "12.5ms", "0xdeadbeef")
    );

    expect(first).toStrictEqual(
      Option.some("parses: AssertionError: <path> took <duration> at <address>")
    );
    expect(
      failureSignature(exit("/work/datekit", "3ms", "0x7f00aa"))
    ).toStrictEqual(first);
  });

  it("is none for a run that failed to load", () => {
    expect(failureSignature(vitestLoadError)).toStrictEqual(Option.none());
    expect(failureSignature(bunLoadError)).toStrictEqual(Option.none());
  });

  it("is none for a run that passed", () => {
    expect(failureSignature({ code: 0, stderr: "", stdout: "" })).toStrictEqual(
      Option.none()
    );
  });
});
