import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { LaneName } from "@repo/protocol/ids";
import { WeakCheck } from "@repo/protocol/refusal";
import { Effect, FileSystem, Option, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { diagnose, Diagnosis, failureSignature } from "../src/classify.ts";
import type { RunExit } from "../src/classify.ts";
import type { RepoFile } from "../src/finder.ts";
import {
  nullAnswer,
  NullAnswerFailed,
  nullAnswerVerdict,
} from "../src/null-answer.ts";
import {
  datesRepo,
  nullDates,
  strongNewCheck,
  weakNewCheck,
} from "./fixtures/null-answer/dates.ts";
import bunAssertion from "./fixtures/runs/bun-assertion.json" with { type: "json" };
import bunLoadError from "./fixtures/runs/bun-load-error.json" with { type: "json" };
import bunNoTests from "./fixtures/runs/bun-no-tests.json" with { type: "json" };
import vitestAssertion from "./fixtures/runs/vitest-assertion.json" with { type: "json" };

const dates = { paths: ["packages/dates/**"] } as const;

const unit = LaneName.make("unit");

const onUnit = (exit: RunExit) => ({ exit, lane: unit });

/** A tree as path → content, to compare whole trees at once. */
const contentsOf = (files: readonly RepoFile[]) =>
  Object.fromEntries(files.map(({ content, path }) => [path, content]));

describe("the null answer", () => {
  it.effect(
    "stubs each function, arrow and class method the territory exports, and leaves the rest as it was",
    () =>
      Effect.gen(function* () {
        const tree = yield* nullAnswer(datesRepo, dates);

        expect(contentsOf(tree)).toStrictEqual({
          ...contentsOf(datesRepo),
          ...contentsOf(nullDates),
        });
      })
  );

  it.effect(
    "reads the territory's public files, when it names them, in place of its exports",
    () =>
      Effect.gen(function* () {
        const tree = yield* nullAnswer(datesRepo, {
          ...dates,
          publicFiles: ["packages/dates/src/parse.ts"],
        });

        const nullParse = nullDates.filter(
          ({ path }) => path === "packages/dates/src/parse.ts"
        );

        expect(contentsOf(tree)).toStrictEqual({
          ...contentsOf(datesRepo),
          ...contentsOf(nullParse),
        });
      })
  );

  it.effect(
    "reads each source file a subpath pattern of its exports leads to",
    () =>
      Effect.gen(function* () {
        const manifest = {
          content: '{ "exports": { "./*": "./src/*.ts" } }\n',
          path: "package.json",
        };

        const tree = yield* nullAnswer(
          [
            manifest,
            {
              content: "export const add = (a: number, b: number) => a + b;\n",
              path: "src/add.ts",
            },
            {
              content:
                "export function half(n: number) {\n  return n / 2;\n}\n",
              path: "src/math/half.ts",
            },
          ],
          { paths: ["src/**"] }
        );

        expect(tree).toStrictEqual([
          manifest,
          {
            content:
              "export const add = (a: number, b: number) => undefined as never;\n",
            path: "src/add.ts",
          },
          {
            content:
              "export function half(n: number) { return undefined as never; }\n",
            path: "src/math/half.ts",
          },
        ]);
      })
  );

  it.effect("reads the main file of a package that has no exports", () =>
    Effect.gen(function* () {
      const manifest = {
        content: '{ "main": "./src/index.ts" }\n',
        path: "package.json",
      };

      const tree = yield* nullAnswer(
        [
          manifest,
          {
            content: "export const twice = (n: number) => n * 2;\n",
            path: "src/index.ts",
          },
        ],
        { paths: ["src/**"] }
      );

      expect(tree).toStrictEqual([
        manifest,
        {
          content: "export const twice = (n: number) => undefined as never;\n",
          path: "src/index.ts",
        },
      ]);
    })
  );

  it.effect("stubs nothing outside the territory", () =>
    Effect.gen(function* () {
      const tree = yield* nullAnswer(datesRepo, {
        paths: ["packages/dates/src/clock.ts"],
      });

      expect(
        tree.filter(
          ({ content, path }) => content !== contentsOf(datesRepo)[path]
        )
      ).toStrictEqual(
        nullDates.filter(({ path }) => path === "packages/dates/src/clock.ts")
      );
    })
  );

  it.effect("fails when the territory has no entry point", () =>
    Effect.gen(function* () {
      expect(
        yield* Effect.flip(nullAnswer(datesRepo, { paths: ["checks/**"] }))
      ).toStrictEqual(
        new NullAnswerFailed({
          path: "checks/**",
          reason:
            "no entry point: the territory names no public files, and no package.json exports a source file for it",
        })
      );
    })
  );

  it.effect(
    "fails when the territory exports no function, arrow or class",
    () =>
      Effect.gen(function* () {
        const constants = [
          { content: "export const LIMIT = 3;\n", path: "src/limits.ts" },
        ];

        expect(
          yield* Effect.flip(
            nullAnswer(constants, {
              paths: ["src/**"],
              publicFiles: ["src/limits.ts"],
            })
          )
        ).toStrictEqual(
          new NullAnswerFailed({
            path: "src/**",
            reason:
              "nothing to stub: the entry points export no function, arrow or class from the territory",
          })
        );
      })
  );

  it.effect("fails on a territory file that does not parse", () =>
    Effect.gen(function* () {
      const broken = [
        { content: "export function parse( {\n", path: "src/parse.ts" },
      ];

      const failed = yield* Effect.flip(
        nullAnswer(broken, { paths: ["src/**"], publicFiles: ["src/parse.ts"] })
      );

      expect(failed).toBeInstanceOf(NullAnswerFailed);
      expect(failed.path).toBe("src/parse.ts");
    })
  );

  it.effect(
    "gives the same tree each time, and leaves its input as it was",
    () =>
      Effect.gen(function* () {
        const before = structuredClone(datesRepo);

        const frozen = Object.freeze(
          datesRepo.map((file) => Object.freeze(file))
        );

        const first = yield* nullAnswer(frozen, dates);
        const second = yield* nullAnswer(frozen, dates);

        expect(second).toStrictEqual(first);
        expect(frozen).toStrictEqual(before);
      })
  );
});

describe(nullAnswerVerdict, () => {
  it("is WeakCheck nullAnswer for a check that passed against the null answer", () => {
    const passed: RunExit = { code: 0, stderr: " 1 pass\n 0 fail", stdout: "" };

    expect(nullAnswerVerdict(onUnit(passed))).toStrictEqual(
      Option.some(new WeakCheck({ weakness: "nullAnswer" }))
    );
  });

  it("is WeakCheck no assertion for a run that found no tests", () => {
    expect(nullAnswerVerdict(onUnit(bunNoTests))).toStrictEqual(
      Option.some(new WeakCheck({ weakness: "no assertion" }))
    );
  });

  it("finds no weakness in a check that failed against the null answer", () => {
    expect([
      nullAnswerVerdict(onUnit(bunAssertion)),
      nullAnswerVerdict(onUnit(vitestAssertion)),
    ]).toStrictEqual([Option.none(), Option.none()]);
  });

  it("finds no weakness in a check that never loaded: that is red first's question", () => {
    expect(nullAnswerVerdict(onUnit(bunLoadError))).toStrictEqual(
      Option.none()
    );
  });
});

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/** The tree in a temp folder of its own, removed when the scope closes. */
const written = (files: readonly RepoFile[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "null-answer-" });

    for (const file of files) {
      const at = path.join(dir, file.path);

      yield* fs.makeDirectory(path.dirname(at), { recursive: true });
      yield* fs.writeFileString(at, file.content);
    }

    return dir;
  });

/** Runs `command` in `dir` under `sh -c`, as the Checker runs a lane: how it ended. */
const ran = (dir: string, command: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const child = yield* spawner.spawn(
        ChildProcess.make("sh", ["-c", command], {
          cwd: dir,
          env: { FORCE_COLOR: "0", NO_COLOR: "1" },
          extendEnv: true,
        })
      );

      const [stdout, stderr, code] = yield* Effect.all(
        [text(child.stdout), text(child.stderr), child.exitCode],
        { concurrency: "unbounded" }
      );

      return { code, stderr, stdout } satisfies RunExit;
    })
  );

describe("a check run against the null answer", () => {
  it.live("runs on a tree that typechecks with tsc --noEmit", () =>
    Effect.gen(function* () {
      const tsc = (yield* Path.Path).resolve("node_modules", ".bin", "tsc");
      const dir = yield* written(yield* nullAnswer(datesRepo, dates));

      const { code, stdout } = yield* ran(
        dir,
        `"${tsc}" --noEmit -p tsconfig.json`
      );

      expect({ code, stdout }).toStrictEqual({ code: 0, stdout: "" });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "is weak when it only asks that the subject exists, and passes anyway",
    () =>
      Effect.gen(function* () {
        const dir = yield* written(yield* nullAnswer(datesRepo, dates));
        const exit = yield* ran(dir, "bun test ./checks/weak.test.ts");

        expect(nullAnswerVerdict(onUnit(exit))).toStrictEqual(
          Option.some(new WeakCheck({ weakness: "nullAnswer" }))
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "is strong when it asserts what the subject returns, and fails by that assertion",
    () =>
      Effect.gen(function* () {
        const dir = yield* written(yield* nullAnswer(datesRepo, dates));
        const exit = yield* ran(dir, "bun test ./checks/strong.test.ts");

        expect({
          byAssertion: Option.isSome(failureSignature(exit)),
          verdict: nullAnswerVerdict(onUnit(exit)),
        }).toStrictEqual({ byAssertion: true, verdict: Option.none() });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

describe("a check written before its subject", () => {
  /** Main with two checks of `weekOf`, which no file exports yet. */
  const beforeWeekOf = [...datesRepo, weakNewCheck, strongNewCheck];

  it.live("fails on main by a load error, not an assertion", () =>
    Effect.gen(function* () {
      const dir = yield* written(beforeWeekOf);
      const exit = yield* ran(dir, "bun test ./checks/week-strong.test.ts");

      expect(Diagnosis.$is("LoadError")(diagnose(exit))).toBeTruthy();
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "loads against the null answer, which stands in for each name it imports from the territory",
    () =>
      Effect.gen(function* () {
        const dir = yield* written(yield* nullAnswer(beforeWeekOf, dates));
        const weak = yield* ran(dir, "bun test ./checks/week-weak.test.ts");
        const strong = yield* ran(dir, "bun test ./checks/week-strong.test.ts");

        expect({
          strongByAssertion: Option.isSome(failureSignature(strong)),
          verdicts: [weak, strong].map((exit) =>
            nullAnswerVerdict(onUnit(exit))
          ),
        }).toStrictEqual({
          strongByAssertion: true,
          verdicts: [
            Option.some(new WeakCheck({ weakness: "nullAnswer" })),
            Option.none(),
          ],
        });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "stands in for a territory file it imports that main lacks, and leaves a type import out",
    () =>
      Effect.gen(function* () {
        const check = {
          content: [
            'import { expect, test } from "bun:test";',
            'import type { Week } from "../packages/dates/src/week.js";',
            'import weeks, { weekOf } from "../packages/dates/src/week.js";',
            "",
            'test("weekOf", () => {',
            "  expect(weekOf(weeks())).toBe(41);",
            "});",
            "",
          ].join("\n"),
          path: "checks/week-file.test.ts",
        };

        const tree = yield* nullAnswer([...datesRepo, check], dates);

        expect(
          tree.filter(({ path }) => path.endsWith("/week.ts"))
        ).toStrictEqual([
          {
            content: [
              "export default function (..._args: readonly unknown[]): never { return undefined as never; }",
              "export function weekOf(..._args: readonly unknown[]): never { return undefined as never; }",
              "",
            ].join("\n"),
            path: "packages/dates/src/week.ts",
          },
        ]);
      })
  );

  it.live("runs on a tree that still typechecks", () =>
    Effect.gen(function* () {
      const tsc = (yield* Path.Path).resolve("node_modules", ".bin", "tsc");
      const dir = yield* written(yield* nullAnswer(beforeWeekOf, dates));

      const { code, stdout } = yield* ran(
        dir,
        `"${tsc}" --noEmit -p tsconfig.json`
      );

      expect({ code, stdout }).toStrictEqual({ code: 0, stdout: "" });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

describe("where ts-morph is reached from", () => {
  it.effect(
    "only the null answer imports it, and no other module of @repo/checks imports the null answer, so no other entry bundles the compiler",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sources = yield* fs.readDirectory("src", { recursive: true });

        // Any quoted specifier counts: a static, dynamic or re-exporting import.
        const tsMorph: string[] = [];
        const theNullAnswer: string[] = [];

        for (const file of sources.filter((each) => each.endsWith(".ts"))) {
          const source = yield* fs.readFileString(path.join("src", file));

          if (/["']ts-morph["']/u.test(source)) {
            tsMorph.push(file);
          }

          if (
            file !== "null-answer.ts" &&
            /["'][^"'\n]*null-answer(?:\.ts)?["']/u.test(source)
          ) {
            theNullAnswer.push(file);
          }
        }

        expect({ theNullAnswer, tsMorph }).toStrictEqual({
          theNullAnswer: [],
          tsMorph: ["null-answer.ts"],
        });
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
