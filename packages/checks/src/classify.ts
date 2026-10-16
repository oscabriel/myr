import type { LaneOutcome } from "@repo/protocol/domain/answer";
import type { LaneName } from "@repo/protocol/ids";
import { Array, Data, Option, Order, pipe, Schema, String } from "effect";

export interface RunExit {
  /** The exit code; negative when the process had none (a signal ended it). */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly report?: unknown;
  readonly timedOut?: boolean;
}

export type Diagnosis =
  | { readonly _tag: "Blocked" }
  | {
      readonly _tag: "Failed";
      // What asserted: red-first's evidence, the same for two runs that failed alike.
      readonly signature: Option.Option<string>;
      // What failed tests threw when none asserted (a timeout, a throw): shown, never red.
      readonly threw: Option.Option<string>;
    }
  | { readonly _tag: "LoadError" }
  | { readonly _tag: "NoTests" }
  | { readonly _tag: "Passed" };

export const Diagnosis = Data.taggedEnum<Diagnosis>();

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

const ASSERTION =
  /AssertionError|^E\s+assert\b|^(?:error: |Error: )?expect\(|^Snapshot .+ mismatched/u;

const EXPECTATION_DETAIL = /^(?:Expected|Received)\b/u;

const LOAD_ERROR = [
  /Cannot find (?:module|package)/u,
  /ERR_MODULE_NOT_FOUND/u,
  /Failed to load url/u,
  /\bSyntaxError\b/u,
  /\b(?:ModuleNotFound|Import)Error\b/u,
  /Transform failed/u,
];

const NO_TESTS = [
  /No test files found/u,
  /did not match any test files|No tests found/u,
  /\bno tests ran\b/u,
  /^ℹ tests 0$/mu,
];

const FAILED_TEST = [
  /^\(fail\) (?<name>.+)$/u,
  /^FAILED (?<name>\S+)/u,
  /^FAIL\s+(?<name>.+)$/u,
];

// turbo's "<package>:<task>: " before each line a workspace's task prints.
const TASK_PREFIX = /^(?:@[\w.-]+\/)?[\w.-]+:[a-z][\w-]*: /u;

// The error a failed test threw, when it was no assertion: a timeout, a throw.
const THROWN = /^\w*Error: /u;

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

// The first error after the first failed test's name, which names no assertion.
const thrownOf = (lines: readonly string[]) =>
  pipe(
    Array.findFirstIndex(lines, (line) =>
      FAILED_TEST.some((pattern) => pattern.test(line))
    ),
    Option.flatMap((at) =>
      Array.findFirst(lines.slice(at + 1), (line) => THROWN.test(line))
    ),
    Option.map(normalise)
  );

const fromOutput = (exit: RunExit): Diagnosis => {
  const output = `${exit.stdout}\n${exit.stderr}`.replaceAll(ANSI, "");

  const lines = output
    .split("\n")
    .map((line) => String.trim(line.replace(TASK_PREFIX, "")));

  const assertion = assertionOf(lines);

  if (Option.isSome(assertion)) {
    const names = signatureOf(failedTestsOf(lines)).replaceAll("\n", " | ");

    return Diagnosis.Failed({
      signature: Option.some(
        names === "" ? assertion.value : `${names}: ${assertion.value}`
      ),
      threw: Option.none(),
    });
  }

  if (NO_TESTS.some((pattern) => pattern.test(output))) {
    return Diagnosis.NoTests();
  }

  if (LOAD_ERROR.some((pattern) => pattern.test(output))) {
    return Diagnosis.LoadError();
  }

  const names = signatureOf(failedTestsOf(lines)).replaceAll("\n", " | ");

  return Diagnosis.Failed({
    signature: Option.none(),
    threw:
      names === ""
        ? Option.none()
        : Option.some(
            Option.match(thrownOf(lines), {
              onNone: () => names,
              onSome: (thrown) => `${names}: ${thrown}`,
            })
          ),
  });
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

    const named = signatureOf(
      failures.map(({ first, name }) => `${name}: ${first}`)
    );

    return Diagnosis.Failed({
      signature: byAssertion ? Option.some(named) : Option.none(),
      threw: byAssertion ? Option.none() : Option.some(named),
    });
  }

  if (report.numTotalTests === 0) {
    return Diagnosis.NoTests();
  }

  return fromOutput(exit);
};

// No exit code (a signal), "not executable" (126), "not found" (127), or
// the shell's 128+n for a process a signal killed.
const neverRan = (code: number) =>
  code < 0 || code === 126 || code === 127 || (code > 128 && code < 160);

// A timeout or a command that never ran is `Blocked`, the verifier's trouble.
// Exit 0 is `Passed` whatever the report says (`--passWithNoTests`).
export const diagnose = (exit: RunExit): Diagnosis => {
  if (exit.timedOut === true || neverRan(exit.code)) {
    return Diagnosis.Blocked();
  }

  if (exit.code === 0) {
    return Diagnosis.Passed();
  }

  return Option.match(decodeReport(exit.report), {
    onNone: () => fromOutput(exit),
    onSome: (report) => fromReport(report, exit),
  });
};

// A single run is never `flaked`: that takes a second run.
export const classifyRun = (lane: LaneName, exit: RunExit): LaneOutcome =>
  Diagnosis.$match(diagnose(exit), {
    Blocked: () => "blocked" as const,
    Failed: () => "failed" as const,
    LoadError: () => "loadError" as const,
    NoTests: () => "loadError" as const,
    Passed: () => "passed" as const,
  });

// Normalised so two runs that failed the same way share a signature.
export const failureSignature = (exit: RunExit): Option.Option<string> => {
  const diagnosis = diagnose(exit);

  return Diagnosis.$is("Failed")(diagnosis)
    ? diagnosis.signature
    : Option.none();
};
