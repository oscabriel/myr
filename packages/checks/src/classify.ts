/**
 * Red for the right reason (CAA D): what one run of a lane says happened.
 * A failure by an assertion is told apart from a run that never got that
 * far (a load or compile error, or no tests at all), from the runner's JSON
 * report where there is one and from its output otherwise.
 */
import type { LaneOutcome } from "@repo/protocol/domain/answer";
import type { LaneName } from "@repo/protocol/ids";
import { Array, Data, Option, Order, pipe, Schema, String } from "effect";

/** How one lane's command ended, as the runner saw it. */
export interface RunExit {
  /** The exit code; negative when the process had none (a signal ended it). */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** The runner's JSON report, when it wrote one (vitest's `--reporter=json`). */
  readonly report?: unknown;
  /** The runner was stopped at the lane's time limit. */
  readonly timedOut?: boolean;
}

/**
 * What one run says happened. `Failed` carries the failing tests' signature
 * when every failure was an assertion's; a test that threw anything else
 * (`TypeError: parseWeek is not a function`) failed with none.
 */
export type Diagnosis =
  | { readonly _tag: "Blocked" }
  | { readonly _tag: "Failed"; readonly signature: Option.Option<string> }
  | { readonly _tag: "LoadError" }
  | { readonly _tag: "NoTests" }
  | { readonly _tag: "Passed" };

export const Diagnosis = Data.taggedEnum<Diagnosis>();

// The fields of vitest's JSON report (jest's shape) that tell what happened.
// A file that failed with a message and collected no tests failed to load.
const VitestReport = Schema.Struct({
  numTotalTests: Schema.Finite,
  testResults: Schema.Array(
    Schema.Struct({
      assertionResults: Schema.Array(
        Schema.Struct({
          failureMessages: Schema.Array(Schema.String),
          fullName: Schema.String,
          status: Schema.String,
        })
      ),
      message: Schema.String,
      status: Schema.String,
    })
  ),
});

type VitestReport = typeof VitestReport.Type;

const decodeReport = Schema.decodeUnknownOption(VitestReport);

/** A line that reports a failed assertion: chai's, node's, jest's and bun's `expect`, pytest's `assert`. */
const ASSERTION =
  /AssertionError|^E\s+assert\b|^(?:error: |Error: )?expect\(|^Snapshot .+ mismatched/u;

/** The details jest and bun print under an `expect(received)` line. */
const EXPECTATION_DETAIL = /^(?:Expected|Received)\b/u;

/** The output of a run that never reached its tests. */
const LOAD_ERROR = [
  /Cannot find (?:module|package)/u,
  /ERR_MODULE_NOT_FOUND/u,
  /Failed to load url/u,
  /\bSyntaxError\b/u,
  /\b(?:ModuleNotFound|Import)Error\b/u,
  /Transform failed/u,
];

/** The output of a run that found no tests: vitest's, bun's or jest's, pytest's, node's. */
const NO_TESTS = [
  /No test files found/u,
  /did not match any test files|No tests found/u,
  /\bno tests ran\b/u,
  /^ℹ tests 0$/mu,
];

/** A line naming a failed test: bun's `(fail)`, pytest's `FAILED`, vitest's `FAIL`. */
const FAILED_TEST = [
  /^\(fail\) (?<name>.+)$/u,
  /^FAILED (?<name>\S+)/u,
  /^FAIL\s+(?<name>.+)$/u,
];

const ANSI = new RegExp(
  `${globalThis.String.fromCharCode(27)}\\[[0-9;]*m`,
  "gu"
);

const ADDRESS = /\b0x[0-9a-fA-F]+\b/gu;

// An absolute path of two or more segments, with any `:line:col`, not the
// tail of a relative one (`test/week.test.ts` stays).
const ABSOLUTE_PATH = /(?<![\w.])(?:file:\/\/)?(?:\/[\w.@+-]+){2,}(?::\d+)*/gu;

const BRACKETED_DURATION = /\s*[[(]\d+(?:\.\d+)?\s?m?s[\])]/gu;

const DURATION = /\b\d+(?:\.\d+)?\s?m?s\b/gu;

/** Without the parts that change between two runs of the same failure. */
const normalise = (text: string) =>
  text
    .replaceAll(ANSI, "")
    .replaceAll(ADDRESS, "<address>")
    .replaceAll(ABSOLUTE_PATH, "<path>")
    .replaceAll(BRACKETED_DURATION, "")
    .replaceAll(DURATION, "<duration>")
    .replaceAll(/\s+/gu, " ")
    .trim();

const firstLine = (text: string) => text.split("\n", 1)[0] ?? "";

const signatureOf = (entries: readonly string[]) =>
  Array.dedupe(entries).toSorted(Order.String).join("\n");

/** The first assertion line, with jest's and bun's `Expected:`/`Received:` lines under it. */
const assertionOf = (lines: readonly string[]) =>
  Option.map(
    Array.findFirstIndex(lines, (line) => ASSERTION.test(line)),
    (at) => {
      const detail = pipe(
        lines.slice(at + 1),
        Array.filter(String.isNonEmpty),
        Array.takeWhile((line) => EXPECTATION_DETAIL.test(line))
      );

      return normalise([lines[at] ?? "", ...detail].join(" "));
    }
  );

const failedTestsOf = (lines: readonly string[]) =>
  pipe(
    lines,
    Array.flatMap((line) =>
      Array.getSomes(
        FAILED_TEST.map((pattern) =>
          Option.fromNullishOr(pattern.exec(line)?.groups?.name)
        )
      )
    ),
    Array.map(normalise)
  );

const fromOutput = (exit: RunExit): Diagnosis => {
  if (exit.code === 0) {
    return Diagnosis.Passed();
  }

  const output = `${exit.stdout}\n${exit.stderr}`.replaceAll(ANSI, "");
  const lines = output.split("\n").map(String.trim);
  const assertion = assertionOf(lines);

  if (Option.isSome(assertion)) {
    const names = signatureOf(failedTestsOf(lines)).replaceAll("\n", " | ");

    return Diagnosis.Failed({
      signature: Option.some(
        names === "" ? assertion.value : `${names}: ${assertion.value}`
      ),
    });
  }

  if (NO_TESTS.some((pattern) => pattern.test(output))) {
    return Diagnosis.NoTests();
  }

  if (LOAD_ERROR.some((pattern) => pattern.test(output))) {
    return Diagnosis.LoadError();
  }

  return Diagnosis.Failed({ signature: Option.none() });
};

const fromReport = (report: VitestReport, exit: RunExit): Diagnosis => {
  const collectFailed = report.testResults.some(
    (file) =>
      file.status === "failed" &&
      file.message !== "" &&
      file.assertionResults.length === 0
  );

  if (collectFailed) {
    return Diagnosis.LoadError();
  }

  const failures = report.testResults
    .flatMap((file) => file.assertionResults)
    .filter((test) => test.status === "failed")
    .map((test) => ({
      first: normalise(firstLine(test.failureMessages[0] ?? "")),
      name: normalise(test.fullName),
    }));

  if (Array.isReadonlyArrayNonEmpty(failures)) {
    const byAssertion = failures.every(({ first }) => ASSERTION.test(first));

    return Diagnosis.Failed({
      signature: byAssertion
        ? Option.some(
            signatureOf(failures.map(({ first, name }) => `${name}: ${first}`))
          )
        : Option.none(),
    });
  }

  if (report.numTotalTests === 0) {
    return Diagnosis.NoTests();
  }

  return exit.code === 0 ? Diagnosis.Passed() : fromOutput(exit);
};

// No exit code (a signal), "not executable" (126), "not found" (127), or
// the shell's 128+n for a process a signal killed.
const neverRan = (code: number) =>
  code < 0 || code === 126 || code === 127 || (code > 128 && code < 160);

/**
 * What one run says happened. A run stopped at its time limit, or one whose
 * command never ran, is `Blocked`: the verifier's trouble, not the answer's.
 */
export const diagnose = (exit: RunExit): Diagnosis => {
  if (exit.timedOut === true || neverRan(exit.code)) {
    return Diagnosis.Blocked();
  }

  return Option.match(decodeReport(exit.report), {
    onNone: () => fromOutput(exit),
    onSome: (report) => fromReport(report, exit),
  });
};

/**
 * How one lane's run ended. `failed` is any failure once the tests ran;
 * `loadError` is a run that never reached them (a load or compile error, or
 * no tests found). A single run is never `flaked`: that takes a second run.
 */
export const classifyRun = (lane: LaneName, exit: RunExit): LaneOutcome =>
  Diagnosis.$match(diagnose(exit), {
    Blocked: () => "blocked" as const,
    Failed: () => "failed" as const,
    LoadError: () => "loadError" as const,
    NoTests: () => "loadError" as const,
    Passed: () => "passed" as const,
  });

/**
 * The failing tests' names and the first line of each one's assertion,
 * normalised (absolute paths, durations and addresses stripped), so two runs
 * that failed the same way have the same signature. None unless the run
 * failed on assertions.
 */
export const failureSignature = (exit: RunExit): Option.Option<string> => {
  const diagnosis = diagnose(exit);

  return Diagnosis.$is("Failed")(diagnosis)
    ? diagnosis.signature
    : Option.none();
};
