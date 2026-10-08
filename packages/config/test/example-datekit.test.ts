/**
 * The datekit example (issue 507), run as the project it pretends to be:
 * `bun test` inside `examples/datekit` is red on main for exactly the three
 * tests its asks name as their checks, each by an assertion rather than a
 * load error (what red first in GLOSSARY.md asks of a check), and green for
 * every other test. The example is a Bun project of its own, outside the
 * workspaces (spec D21), so it is run as a child process, the way the
 * platform's Checker runs a project's own test command.
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { Brand } from "../../../scripts/lib/gen.ts";
import { repoRoot } from "./root.ts";

/** The example, from the repo root. */
const example = "examples/datekit";

/** What one run of `bun test` printed, both streams, and how it ended. */
interface BunRun {
  readonly exitCode: number;
  readonly output: string;
}

/** One test file's part of bun's report: the tests it failed, and its text. */
interface FileReport {
  readonly failed: readonly string[];
  readonly file: string;
  readonly text: string;
}

/** Bun's report, read: each file it reported on, and its closing counts. */
interface BunReport {
  readonly errors: number;
  readonly failed: number;
  readonly files: readonly FileReport[];
  readonly passed: number;
  /** How many tests bun ran, across how many files. */
  readonly ran: { readonly files: number; readonly tests: number };
}

const ANSI = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, "gu");

// Bun opens a file's part with its path and a colon, when the file has
// anything to report (a failure or an error); a passing file prints nothing.
const FILE_HEADER = /^(?<file>\S+\.test\.[cm]?[jt]sx?):$/u;

// A failed test: `(fail) describe > test [0.24ms]`, or `✗ …` when bun
// prints in color.
const FAILED_TEST = /^(?:\(fail\)|✗) (?<name>.+?)(?: \[[\d.]+m?s\])?$/u;

// Where the files' parts end: the recap of failed tests some runs print
// (`3 tests failed:`), or else the closing counts (` 34 pass`).
const CLOSING = /^(?:\d+ tests? failed:|\d+ pass)$/u;

// The line bun prints under a failed `expect(…)` (the platform's classifier
// reads the same line as an assertion).
const ASSERTION = /^error: expect\(received\)/mu;

// What bun prints when a file never reached its tests.
const LOAD_ERRORS = [
  /Cannot find (?:module|package)/u,
  /\bSyntaxError\b/u,
  /Unhandled error between tests/u,
  /\bReferenceError\b/u,
];

// An ask file names its check file as the `path` its kind takes
// (`kinds.fix.ask({ path: "test/asks/<id>.test.ts", … })`), which the kind
// makes the ask's `RedThenGreen.path`.
const CHECK_PATH = /\bpath:\s*"(?<path>[^"]+)"/u;

/** A closing count bun prints (` 3 fail`), or 0 when it prints none. */
const countOf = (output: string, word: string) =>
  Number(
    new RegExp(`^\\s*(?<count>\\d+) ${word}$`, "mu").exec(output)?.groups
      ?.count ?? "0"
  );

/** The name a `(fail)` line gives, if the line is one. */
const failedIn = (line: string) => {
  const name = FAILED_TEST.exec(line)?.groups?.name;

  return name === undefined ? [] : [name];
};

/** Reads bun's console report into its files and counts. */
const readReport = (output: string): BunReport => {
  const lines = output.split("\n").map((line) => line.trim());

  const starts = lines.flatMap((line, at) =>
    FILE_HEADER.test(line) ? [at] : []
  );

  const closing = lines.findIndex((line) => CLOSING.test(line));
  const end = closing === -1 ? lines.length : closing;

  const files = starts.map((start, index) => {
    const part = lines.slice(
      start + 1,
      Math.min(starts[index + 1] ?? end, end)
    );

    return {
      failed: part.flatMap(failedIn),
      file: FILE_HEADER.exec(lines[start] ?? "")?.groups?.file ?? "",
      text: part.join("\n"),
    };
  });

  const ran = /^Ran (?<tests>\d+) tests? across (?<files>\d+) files?\./mu.exec(
    output
  )?.groups;

  return {
    errors: countOf(output, "errors?"),
    failed: countOf(output, "fail"),
    files,
    passed: countOf(output, "pass"),
    ran: { files: Number(ran?.files), tests: Number(ran?.tests) },
  };
};

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/** Runs `bun test` inside the example, as its own `package.json` does. */
const bunTest = Effect.scoped(
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const root = yield* repoRoot;

    const child = yield* spawner.spawn(
      ChildProcess.make("bun", ["test"], { cwd: path.join(root, example) })
    );

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [text(child.stdout), text(child.stderr), child.exitCode],
      { concurrency: "unbounded" }
    );

    return {
      exitCode,
      output: `${stdout}\n${stderr}`.replaceAll(ANSI, ""),
    } satisfies BunRun;
  })
);

/**
 * Each ask file in the example's config folder, and the check file it names;
 * none when the folder is missing.
 */
const askChecks = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const asks = path.join(yield* repoRoot, example, Brand.configDir, "asks");

  if (!(yield* fs.exists(asks))) {
    return [];
  }

  const files = (yield* fs.readDirectory(asks))
    .filter((file) => file.endsWith(".ask.ts"))
    .toSorted();

  return yield* Effect.forEach(files, (file) =>
    Effect.map(fs.readFileString(path.join(asks, file)), (source) => ({
      check: CHECK_PATH.exec(source)?.groups?.path ?? "",
      file,
    }))
  );
});

/** How a file failed: how many tests, whether by an assertion, whether it loaded. */
const howFailed = ({ failed, file, text: part }: FileReport) => ({
  assertion: ASSERTION.test(part),
  file,
  loaded: !LOAD_ERRORS.some((pattern) => pattern.test(part)),
  tests: failed.length,
});

const byFile = (a: { readonly file: string }, b: { readonly file: string }) =>
  a.file.localeCompare(b.file);

describe("the datekit example", () => {
  it.live(
    "is red on main for exactly its three asks' checks, each by an assertion, and green elsewhere",
    () =>
      Effect.gen(function* () {
        const run = yield* bunTest;
        const report = readReport(run.output);
        const checks = yield* askChecks;

        expect(checks.map(({ file }) => file)).toStrictEqual([
          "add-months-clamp.ask.ts",
          "format-ordinal.ask.ts",
          "parse-iso-week.ask.ts",
        ]);

        // The run fails, and only by the asks' checks: one test in each, by
        // an assertion, with nothing that failed to load.
        expect({
          errors: report.errors,
          exitedNonZero: run.exitCode !== 0,
          failed: report.failed,
          failing: report.files
            .filter(({ failed }) => failed.length > 0)
            .map(howFailed)
            .toSorted(byFile),
        }).toStrictEqual({
          errors: 0,
          exitedNonZero: true,
          failed: 3,
          failing: checks
            .map(({ check }) => ({
              assertion: true,
              file: check,
              loaded: true,
              tests: 1,
            }))
            .toSorted(byFile),
        });

        // Every other test passes, across the four suites the library keeps
        // green (parse, format, add, diff) and the three checks.
        expect({
          files: report.ran.files,
          passedOrFailed: report.passed + report.failed,
        }).toStrictEqual({ files: 7, passedOrFailed: report.ran.tests });
        expect(report.passed).toBeGreaterThan(0);
      }).pipe(Effect.provide(NodeServices.layer)),
    // One `bun test` over a small library: well under a second alone. The
    // limit catches a hang while turbo runs every package's tests at once.
    30_000
  );
});
