import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Random, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { noManualEffectRuntimeInTests } from "../../../tools/oxlint/fence/rules/no-manual-effect-runtime-in-tests.ts";
import { noModuleLevelMutableState } from "../../../tools/oxlint/fence/rules/no-module-level-mutable-state.ts";

// Vitest runs in the package's folder, two below the repo root.
const repoRoot = Effect.map(Path.Path, (path) => path.resolve("..", ".."));

const fixtures = "tools/oxlint/fence/fixtures";

const OxlintReport = Schema.Struct({
  diagnostics: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      filename: Schema.String,
      labels: Schema.NonEmptyArray(
        Schema.Struct({ span: Schema.Struct({ line: Schema.Int }) })
      ),
      message: Schema.String,
      severity: Schema.String,
    })
  ),
  number_of_files: Schema.Int,
});

/** oxlint's JSON names a rule `fence(<rule>)`; the config names it `fence/<rule>`. */
const ruleId = (code: string) =>
  code.replace(/^(?<plugin>[^(]+)\((?<rule>[^)]+)\)$/u, "$<plugin>/$<rule>");

/** Each message text the fence rules can report, mapped back to its id. */
const messageIds = new Map(
  [noManualEffectRuntimeInTests, noModuleLevelMutableState].flatMap((rule) =>
    Object.entries(rule.meta?.messages ?? {}).map(([id, text]) => [text, id])
  )
);

/**
 * Runs the real oxlint from the repo root over `files` (relative to `base`)
 * and returns what the fence rules found, in path and line order.
 */
const lint = (config: string, base: string, files: readonly string[]) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const root = yield* repoRoot;

    const json = yield* spawner.string(
      ChildProcess.make(
        path.join(root, "node_modules/.bin/oxlint"),
        [
          "-c",
          config,
          "--format",
          "json",
          ...files.map((file) => path.join(base, file)),
        ],
        { cwd: root }
      )
    );

    const report = yield* Schema.decodeEffect(
      Schema.fromJsonString(OxlintReport)
    )(json);

    const findings = report.diagnostics
      .filter(({ code }) => code.startsWith("fence("))
      .map(({ code, filename, labels, message, severity }) => ({
        file: path.relative(base, filename),
        line: labels[0].span.line,
        messageId: messageIds.get(message) ?? message,
        ruleId: ruleId(code),
        severity,
      }))
      .toSorted((a, b) =>
        a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)
      );

    return { files: report.number_of_files, findings };
  });

/** What each rule reports, at error, for one line of one file. */
const moduleStateAt = (file: string, line: number) => ({
  file,
  line,
  messageId: "moduleState",
  ruleId: "fence/no-module-level-mutable-state",
  severity: "error",
});

const manualRunnerAt = (file: string, line: number) => ({
  file,
  line,
  messageId: "manualRunner",
  ruleId: "fence/no-manual-effect-runtime-in-tests",
  severity: "error",
});

describe("fence/no-module-level-mutable-state", () => {
  it.live(
    "flags module-level let and var in src/, and nothing ambient, in functions, in Layers or in tests",
    () =>
      Effect.gen(function* () {
        const { files, findings } = yield* lint(
          `${fixtures}/oxlint.json`,
          fixtures,
          [
            "packages/demo/src/bad-state.ts",
            "packages/demo/src/good-state.ts",
            "packages/demo/test/state.test.ts",
          ]
        );

        expect(files).toBe(3);
        expect(findings).toStrictEqual([
          moduleStateAt("packages/demo/src/bad-state.ts", 3),
          moduleStateAt("packages/demo/src/bad-state.ts", 6),
        ]);
      }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("fence/no-manual-effect-runtime-in-tests", () => {
  it.live(
    "flags Effect.runPromise and ManagedRuntime.make in a test, and passes it.effect and a runner in src/",
    () =>
      Effect.gen(function* () {
        const { files, findings } = yield* lint(
          `${fixtures}/oxlint.json`,
          fixtures,
          [
            "packages/demo/test/bad-runtime.test.ts",
            "packages/demo/test/good-runtime.test.ts",
            "packages/demo/src/good-state.ts",
          ]
        );

        expect(files).toBe(3);
        expect(findings).toStrictEqual([
          manualRunnerAt("packages/demo/test/bad-runtime.test.ts", 5),
          manualRunnerAt("packages/demo/test/bad-runtime.test.ts", 9),
        ]);
      }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("the fence messages", () => {
  it("say why module state is refused, and what a test runs Effects with", () => {
    expect(noModuleLevelMutableState.meta?.messages?.moduleState).toContain(
      "Worker isolate"
    );
    expect(noManualEffectRuntimeInTests.meta?.messages?.manualRunner).toMatch(
      /it\.effect\(.*it\.layer\(/u
    );
  });
});

describe("the root lint config", () => {
  it.live(
    "switches each fence rule on, at error, for the files it guards",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* repoRoot;

        // The copy is a package of its own, `packages/<x>/{src,test}`, so the
        // root config resolves it as it resolves a real package, anchored
        // globs (`packages/*/src/**`) included. Its name ends in `.log`, which
        // is gitignored: `git status` and a tree-wide `check` skip it, while
        // oxlint 1.87 still lints a path named on its command line. The random
        // part keeps two runs apart; the Scope removes it.
        const id = yield* Random.nextIntBetween(0, 2 ** 32);
        const workspace = `packages/oxlint-fence-${id.toString(36)}.log`;
        const directory = path.join(root, workspace);

        yield* Effect.acquireRelease(fs.makeDirectory(directory), () =>
          Effect.orDie(fs.remove(directory, { recursive: true }))
        );

        const copies = [
          ["packages/demo/src/bad-state.ts", "src/state.ts"],
          ["packages/demo/test/bad-runtime.test.ts", "test/runtime.test.ts"],
        ] as const;

        for (const [fixture, copy] of copies) {
          const target = path.join(directory, copy);

          yield* fs.makeDirectory(path.dirname(target), { recursive: true });
          yield* fs.copyFile(path.join(root, fixtures, fixture), target);
        }

        const { files, findings } = yield* lint(
          "oxlint.config.ts",
          workspace,
          copies.map(([, copy]) => copy)
        );

        expect(files).toBe(2);
        expect(findings).toStrictEqual([
          moduleStateAt("src/state.ts", 3),
          moduleStateAt("src/state.ts", 6),
          manualRunnerAt("test/runtime.test.ts", 5),
          manualRunnerAt("test/runtime.test.ts", 9),
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
