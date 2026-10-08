/**
 * The datekit example, run as the project it pretends to be:
 * `bun test` inside `examples/datekit` is red on main for exactly the three
 * tests its asks name as their checks, each by an assertion rather than a
 * load error (what red first in GLOSSARY.md asks of a check), and green for
 * every other test. Its run block holds on main too: every lane passes, and
 * each ask's check, run alone by the block's test command, is red by an
 * assertion. The example is a Bun project of its own, outside the
 * workspaces, so each command runs as a child process under
 * `sh -c`, the way the platform's Checker runs a project's commands, in a
 * copy of its public tree: every file git tracks but its layers (`layers/`,
 * pushed to the private namespace, never to main).
 */
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { Brand } from "../../brand/src/index.ts";
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

// The run block as project.ts writes it (the rules test holds it to the
// evaluated policy): the command that runs one check file, with `{path}`
// in it, and the lanes every answer must pass, `checks: { unit: "…" }`.
const TEST_COMMAND = /\btest:\s*"(?<command>[^"]*\{path\}[^"]*)"/u;

const LANES = /\bchecks:\s*\{(?<lanes>[^}]*)\}/u;

const LANE = /(?<lane>\w+):\s*"(?<command>[^"]+)"/gu;

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

/**
 * The example's public tree in a folder of its own, for as long as the
 * scope lasts: every file git tracks under it but its layers, as the seed
 * pushes main.
 */
const publicTree = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* repoRoot;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "datekit-main-" });

  const tracked = yield* spawner.string(
    ChildProcess.make("git", ["ls-files", "-z", "--", example], { cwd: root })
  );

  const files = tracked
    .split("\0")
    .filter((file) => file.startsWith(`${example}/`))
    .map((file) => file.slice(example.length + 1))
    .filter((file) => !file.startsWith("layers/"));

  for (const file of files) {
    yield* fs.makeDirectory(path.dirname(path.join(dir, file)), {
      recursive: true,
    });
    yield* fs.copyFile(path.join(root, example, file), path.join(dir, file));
  }

  return dir;
});

/** Runs `command` in the example's public tree at `dir` under `sh -c`, as the Checker runs a lane. */
const inTree = (dir: string, command: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const child = yield* spawner.spawn(
        ChildProcess.make("sh", ["-c", command], { cwd: dir })
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

/** The example's run block, read from its project file. */
const runBlock = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const source = yield* fs.readFileString(
    path.join(yield* repoRoot, example, Brand.configDir, "project.ts")
  );

  const lanes = Array.from(
    (LANES.exec(source)?.groups?.lanes ?? "").matchAll(LANE),
    ({ groups }) => ({
      command: groups?.command ?? "",
      lane: groups?.lane ?? "",
    })
  );

  return { lanes, test: TEST_COMMAND.exec(source)?.groups?.command ?? "" };
});

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
        // The example's own `package.json` test script.
        const run = yield* inTree(yield* publicTree, "bun test");
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
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    // One `bun test` over a small library: well under a second alone. The
    // limit catches a hang while turbo runs every package's tests at once.
    30_000
  );

  it.live(
    "holds its run block on main: every lane green, and each ask's check red alone by an assertion",
    () =>
      Effect.gen(function* () {
        const { lanes, test } = yield* runBlock;
        const checks = yield* askChecks;
        const tree = yield* publicTree;

        // A lane red on main refuses every answer (`VerifierBlocked`), so the
        // suite every answer keeps green leaves the open asks' checks out and
        // runs the four the library keeps green.
        const laneRuns = yield* Effect.forEach(lanes, ({ command, lane }) =>
          Effect.map(inTree(tree, command), (run) => {
            const report = readReport(run.output);

            return {
              errors: report.errors,
              exitCode: run.exitCode,
              failed: report.failed,
              files: report.ran.files,
              lane,
            };
          })
        );

        expect(laneRuns).toStrictEqual([
          { errors: 0, exitCode: 0, failed: 0, files: 4, lane: "unit" },
        ]);

        // The platform opens an ask only when its check is red first
        // (`NotRedFirst` otherwise): the test command, with the check's path
        // for `{path}`, fails its one test by an assertion.
        const checkRuns = yield* Effect.forEach(checks, ({ check }) =>
          Effect.map(inTree(tree, test.replaceAll("{path}", check)), (run) => {
            const report = readReport(run.output);

            return {
              errors: report.errors,
              exitedNonZero: run.exitCode !== 0,
              failing: report.files
                .filter(({ failed }) => failed.length > 0)
                .map(howFailed),
            };
          })
        );

        expect(checkRuns).toStrictEqual(
          [
            "test/asks/add-months-clamp.test.ts",
            "test/asks/format-ordinal.test.ts",
            "test/asks/parse-iso-week.test.ts",
          ].map((file) => ({
            errors: 0,
            exitedNonZero: true,
            failing: [{ assertion: true, file, loaded: true, tests: 1 }],
          }))
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    // Four `bun test` runs over a small library, one after another.
    30_000
  );
});
