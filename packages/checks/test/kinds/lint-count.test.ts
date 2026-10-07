import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Glob } from "@repo/protocol/domain/common";
import { RepoPath } from "@repo/protocol/ids";
import { Effect, FileSystem, Option, Result } from "effect";

import { countLint } from "../../src/kinds/lint-count.ts";
import type {
  CountUnreadable,
  LintCount,
  LintFormat,
} from "../../src/kinds/lint-count.ts";

// Recorded stdout, byte for byte, from one fixture repo of four files:
//
//   packages/parser/src/parse.ts  3 `any`, 1 `debugger`
//   packages/parser/src/date.ts   1 `any`
//   packages/lexer/src/lex.ts     1 `any`
//   packages/printer/src/print.ts 1 `debugger`
//
// `oxlint.stdout`: this repo's oxlint 1.87.0, run in the fixture's root as
// `oxlint --format json -A all -D typescript/no-explicit-any -D no-debugger
// packages`. `oxlint-clean.stdout`: the same, `-D typescript/no-explicit-any`
// over `packages/printer` alone. `oxlint-default.stdout`: the first command
// without `--format json`. `eslint.stdout`: ESLint 9.39.5 with
// typescript-eslint 8.63.0 (`@typescript-eslint/no-explicit-any` and
// `no-debugger` at error), `eslint --format json packages`; ESLint prints
// absolute paths, and the scratch folder it ran in is rewritten to
// `/srv/fixture`.
const recorded = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return yield* fs.readFileString(
      `${import.meta.dirname}/../fixtures/lint/${name}.stdout`
    );
  }).pipe(Effect.orDie, Effect.provide(NodeServices.layer));

const ESLINT_ROOT = "/srv/fixture";

const parse = RepoPath.make("packages/parser/src/parse.ts");

const date = RepoPath.make("packages/parser/src/date.ts");

const lex = RepoPath.make("packages/lexer/src/lex.ts");

const print = RepoPath.make("packages/printer/src/print.ts");

const counted = (entries: readonly (readonly [RepoPath, number])[]) =>
  Result.succeed<LintCount>({
    byPath: new Map(entries),
    total: entries.reduce((sum, [, count]) => sum + count, 0),
  });

const anys = counted([
  [parse, 3],
  [date, 1],
  [lex, 1],
]);

const debuggers = counted([
  [parse, 1],
  [print, 1],
]);

const globs = (...patterns: readonly string[]) =>
  patterns.map((pattern) => Glob.make(pattern));

/** What an unreadable count kept of the output, or `None` when it counted. */
const unreadHead = (result: Result.Result<LintCount, CountUnreadable>) =>
  Result.match(result, {
    onFailure: ({ head }) => Option.some(head),
    onSuccess: () => Option.none(),
  });

/** Both recordings, each with what makes its paths repo-relative. */
const both = Effect.all({
  eslint: recorded("eslint").pipe(
    Effect.map((output) => ({ output, root: ESLINT_ROOT }))
  ),
  oxlint: recorded("oxlint").pipe(Effect.map((output) => ({ output }))),
});

/** How many `any`s a recording counts within a territory's globs. */
const anysWithin = (
  input: { readonly output: string; readonly root?: string },
  territory: readonly string[]
) =>
  Result.map(
    countLint({
      ...input,
      rule: "typescript/no-explicit-any",
      territory: globs(...territory),
    }),
    (count) => count.total
  );

describe(countLint, () => {
  it.effect("counts every finding in oxlint's JSON, per path", () =>
    Effect.gen(function* () {
      const output = yield* recorded("oxlint");

      expect(countLint({ output })).toStrictEqual(
        counted([
          [parse, 4],
          [date, 1],
          [lex, 1],
          [print, 1],
        ])
      );
    })
  );

  it.effect("counts every finding in ESLint's JSON, per repo path", () =>
    Effect.gen(function* () {
      const output = yield* recorded("eslint");

      expect(countLint({ output, root: ESLINT_ROOT })).toStrictEqual(
        counted([
          [parse, 4],
          [date, 1],
          [lex, 1],
          [print, 1],
        ])
      );
    })
  );

  it.effect("keeps ESLint's absolute paths when no root is given", () =>
    Effect.gen(function* () {
      const output = yield* recorded("eslint");
      const count = Result.getOrThrow(countLint({ output }));

      expect([...count.byPath.keys()]).toContain(
        `${ESLINT_ROOT}/packages/lexer/src/lex.ts`
      );
    })
  );

  it.effect.each([
    "typescript/no-explicit-any",
    "@typescript-eslint/no-explicit-any",
    "typescript-eslint(no-explicit-any)",
    "typescript(no-explicit-any)",
    "no-explicit-any",
  ])("counts one rule written as %s, in either tool's output", (rule) =>
    Effect.gen(function* () {
      const { eslint, oxlint } = yield* both;

      expect(countLint({ ...oxlint, rule })).toStrictEqual(anys);
      expect(countLint({ ...eslint, rule })).toStrictEqual(anys);
    })
  );

  it.effect.each(["no-debugger", "eslint/no-debugger", "eslint(no-debugger)"])(
    "counts a core rule written as %s, in either tool's output",
    (rule) =>
      Effect.gen(function* () {
        const { eslint, oxlint } = yield* both;

        expect(countLint({ ...oxlint, rule })).toStrictEqual(debuggers);
        expect(countLint({ ...eslint, rule })).toStrictEqual(debuggers);
      })
  );

  it.effect("counts nothing for a rule in another plugin", () =>
    Effect.gen(function* () {
      const { eslint, oxlint } = yield* both;
      const rule = "unicorn/no-explicit-any";

      expect(countLint({ ...oxlint, rule })).toStrictEqual(counted([]));
      expect(countLint({ ...eslint, rule })).toStrictEqual(counted([]));
    })
  );

  it.effect.each<readonly [string, readonly string[], LintCount["total"]]>([
    ["one package", ["packages/parser/**"], 4],
    ["two packages", ["packages/parser/**", "packages/lexer/**"], 5],
    ["all but one", ["packages/**", "!packages/lexer/**"], 4],
    ["one file", ["packages/parser/src/date.ts"], 1],
    ["a package with none", ["packages/printer/**"], 0],
  ])("counts within a territory: %s", ([, territory, total]) =>
    Effect.gen(function* () {
      const { eslint, oxlint } = yield* both;

      expect(anysWithin(oxlint, territory)).toStrictEqual(
        Result.succeed(total)
      );
      expect(anysWithin(eslint, territory)).toStrictEqual(
        Result.succeed(total)
      );
    })
  );

  it.effect("names only the territory's paths", () =>
    Effect.gen(function* () {
      const output = yield* recorded("oxlint");

      expect(
        countLint({ output, territory: globs("packages/parser/**") })
      ).toStrictEqual(
        counted([
          [parse, 4],
          [date, 1],
        ])
      );
    })
  );

  it.effect("reads a clean run as zero", () =>
    Effect.gen(function* () {
      const output = yield* recorded("oxlint-clean");

      expect(countLint({ output })).toStrictEqual(counted([]));
      expect(countLint({ format: "oxlint", output })).toStrictEqual(
        counted([])
      );
      // ESLint over no files prints an empty array.
      expect(countLint({ output: "[]\n" })).toStrictEqual(counted([]));
    })
  );

  it.effect.each<readonly [LintFormat, string]>([
    ["oxlint", "eslint"],
    ["eslint", "oxlint"],
  ])("refuses %s's format for %s's output", ([format, other]) =>
    Effect.gen(function* () {
      const output = yield* recorded(other);

      expect(unreadHead(countLint({ format, output }))).toStrictEqual(
        Option.some(output.slice(0, 200))
      );
    })
  );

  it.effect("keeps the first 200 characters of oxlint's text output", () =>
    Effect.gen(function* () {
      const output = yield* recorded("oxlint-default");

      expect(output.length).toBeGreaterThan(200);
      expect(unreadHead(countLint({ output }))).toStrictEqual(
        Option.some(output.slice(0, 200))
      );
    })
  );

  it.each([
    ["nothing", ""],
    ["a crash", "Segmentation fault (core dumped)\n"],
    ["JSON of another shape", '{"total": 3}'],
    [
      "a finding with no path",
      '{"diagnostics": [{"code": "eslint(no-debugger)"}]}',
    ],
    ["ESLint's shape with no messages", '[{"filePath": "/srv/a.ts"}]'],
    ["a bare number", "7"],
  ])("never throws on %s, and keeps what it printed", (_label, output) => {
    expect(unreadHead(countLint({ output }))).toStrictEqual(
      Option.some(output)
    );
  });
});
