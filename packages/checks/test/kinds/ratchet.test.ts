import { describe, expect, it } from "@effect/vitest";
import { RatchetMeasure, RatchetSpec } from "@repo/protocol/domain/check";
import { Command, Glob, JsonPath } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Territory } from "@repo/protocol/domain/territory";
import { AskId, RatchetName } from "@repo/protocol/ids";
import { Weakened } from "@repo/protocol/refusal";
import { Effect, Exit, Ref, Schema } from "effect";

import { CountUnreadable } from "../../src/kinds/lint-count.ts";
import { countLanes, judgeRatchets, measure } from "../../src/kinds/ratchet.ts";
import type { RatchetCount } from "../../src/kinds/ratchet.ts";
import { recorded } from "./recorded.ts";

// The recordings `lint-count.test.ts` describes: `any` three times in
// parse.ts and once in date.ts (packages/parser), once in lex.ts
// (packages/lexer), never in packages/printer.

const module = (name: string, folder: string): Territory => ({
  module: name,
  paths: [Glob.make(`${folder}/**`)],
});

const territories = [
  module("@fixture/parser", "packages/parser"),
  module("@fixture/lexer", "packages/lexer"),
  module("@fixture/printer", "packages/printer"),
];

const anyCount = RatchetName.make("anyCount");

const lintCommand = "oxlint --format json";

/** Counts `any` with the project's linter, in every territory. */
const counting = RatchetSpec.make({
  measure: RatchetMeasure.cases.Count.make({
    command: Command.make(lintCommand),
    rule: "typescript/no-explicit-any",
  }),
  name: anyCount,
});

/** Counts `any` in the one territory the spec names. */
const countingIn = (territory: string) =>
  RatchetSpec.make({ ...counting, territory });

const bundleKb = RatchetName.make("bundleKb");

const bundleCommand = "bun scripts/bundle-size.ts --json";

/** Reads one number from a bundle report, for the whole project. */
const bundle = RatchetSpec.make({
  measure: RatchetMeasure.cases.Metric.make({
    command: Command.make(bundleCommand),
    path: JsonPath.make("$.parts[1].kb"),
  }),
  name: bundleKb,
});

/** A fake runner that prints `stdout` for any command, exiting 1 as a linter with findings does, and keeps what it was asked to run. */
const printing = (stdout: string) =>
  Effect.gen(function* () {
    const ran = yield* Ref.make<readonly string[]>([]);

    const run = (command: string) =>
      Ref.update(ran, (commands) => [...commands, command]).pipe(
        Effect.as({ code: 1, stdout })
      );

    return { ran, run };
  });

describe(measure, () => {
  it.effect("counts once per territory, from one run of the command", () =>
    Effect.gen(function* () {
      const { ran, run } = yield* printing(yield* recorded("oxlint"));

      expect(yield* measure(counting, run, territories)).toStrictEqual([
        { count: 4, ratchet: anyCount, territory: "@fixture/parser" },
        { count: 1, ratchet: anyCount, territory: "@fixture/lexer" },
        { count: 0, ratchet: anyCount, territory: "@fixture/printer" },
      ]);
      expect(yield* Ref.get(ran)).toStrictEqual([lintCommand]);
    })
  );

  it.effect("counts only the territory a spec names, by its module", () =>
    Effect.gen(function* () {
      const { run } = yield* printing(yield* recorded("oxlint"));

      expect(
        yield* measure(countingIn("@fixture/lexer"), run, territories)
      ).toStrictEqual([
        { count: 1, ratchet: anyCount, territory: "@fixture/lexer" },
      ]);
    })
  );

  it.effect("reads a territory no module names as a glob", () =>
    Effect.gen(function* () {
      const { run } = yield* printing(yield* recorded("oxlint"));

      expect(
        yield* measure(countingIn("packages/parser/src/parse.ts"), run, [])
      ).toStrictEqual([
        {
          count: 3,
          ratchet: anyCount,
          territory: "packages/parser/src/parse.ts",
        },
      ]);
    })
  );

  it.effect("counts a project with no modules as one territory, `.`", () =>
    Effect.gen(function* () {
      const { run } = yield* printing(yield* recorded("oxlint"));

      expect(yield* measure(counting, run, [])).toStrictEqual([
        { count: 5, ratchet: anyCount, territory: "." },
      ]);
    })
  );

  it.effect("makes ESLint's absolute paths repo-relative against a root", () =>
    Effect.gen(function* () {
      const { run } = yield* printing(yield* recorded("eslint"));

      expect(
        yield* measure(counting, run, territories, { root: "/srv/fixture" })
      ).toStrictEqual([
        { count: 4, ratchet: anyCount, territory: "@fixture/parser" },
        { count: 1, ratchet: anyCount, territory: "@fixture/lexer" },
        { count: 0, ratchet: anyCount, territory: "@fixture/printer" },
      ]);
    })
  );

  it.effect("reads a metric as one count, for the territory it names", () =>
    Effect.gen(function* () {
      const { ran, run } = yield* printing(
        '{"total": 412, "parts": [{"kb": 3}, {"kb": 9}]}'
      );

      expect(
        yield* measure(
          RatchetSpec.make({ ...bundle, territory: "@fixture/printer" }),
          run,
          territories
        )
      ).toStrictEqual([
        { count: 9, ratchet: bundleKb, territory: "@fixture/printer" },
      ]);
      expect(yield* measure(bundle, run, territories)).toStrictEqual([
        { count: 9, ratchet: bundleKb, territory: "." },
      ]);
      expect(yield* Ref.get(ran)).toStrictEqual([bundleCommand, bundleCommand]);
    })
  );

  it.effect("fails with CountUnreadable when the output holds no count", () =>
    Effect.gen(function* () {
      const output = yield* recorded("oxlint-default");
      const { run } = yield* printing(output);

      expect(
        yield* Effect.exit(measure(counting, run, territories))
      ).toStrictEqual(Exit.fail(CountUnreadable.of(output)));
    })
  );

  it.effect("passes the runner's own failure through", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        measure(counting, () => Effect.fail("no checker" as const), [])
      );

      expect(exit).toStrictEqual(Exit.fail("no checker"));
    })
  );
});

describe(countLanes, () => {
  it("runs each command once, in a lane named for the first ratchet that runs it, handing back what it printed", () => {
    const anyInLexer = RatchetSpec.make({
      ...counting,
      name: RatchetName.make("anyInLexer"),
      territory: "@fixture/lexer",
    });

    expect(countLanes([counting, bundle, anyInLexer])).toStrictEqual([
      { command: lintCommand, lane: "anyCount", output: "stdout" },
      { command: bundleCommand, lane: "bundleKb", output: "stdout" },
    ]);
  });

  it("runs nothing for a project with no ratchets", () => {
    expect(countLanes([])).toStrictEqual([]);
  });
});

const ask = AskId.make("parse-dates");

const parser = "@fixture/parser";

const counted = (count: number, territory = parser): RatchetCount => ({
  count,
  ratchet: anyCount,
  territory,
});

const raising = {
  ratchet: anyCount,
  reason: "the parser's one cast, until the date types land",
  territory: parser,
};

const wire = (refusals: readonly Weakened[]) =>
  refusals.map((refusal) => Schema.encodeSync(Weakened)(refusal));

describe(judgeRatchets, () => {
  it("refuses an answer that raises a ratchet with Weakened", () => {
    const { decisions, refusals } = judgeRatchets({
      ask,
      baselines: [counted(14)],
      measured: [counted(15)],
      raises: [],
    });

    expect(decisions).toStrictEqual([]);
    expect(wire(refusals)).toStrictEqual(
      wire([
        new Weakened({
          weakening: {
            after: 15,
            before: 14,
            ratchet: anyCount,
            territory: parser,
          },
        }),
      ])
    );
  });

  it.each([14, 12, 0])("lets an answer through at %i", (count) => {
    expect(
      judgeRatchets({
        ask,
        baselines: [counted(14)],
        measured: [counted(count)],
        raises: [],
      })
    ).toStrictEqual({ decisions: [], refusals: [] });
  });

  it("turns an asked-for raise into one RaiseRatchet decision, not a refusal", () => {
    expect(
      judgeRatchets({
        ask,
        baselines: [counted(14)],
        measured: [counted(15)],
        raises: [raising],
      })
    ).toStrictEqual({
      decisions: [
        DecisionSubject.cases.RaiseRatchet.make({
          after: 15,
          ask,
          before: 14,
          ratchet: anyCount,
          territory: parser,
        }),
      ],
      refusals: [],
    });
  });

  it("refuses a raise asked for in another territory", () => {
    const { decisions, refusals } = judgeRatchets({
      ask,
      baselines: [counted(14)],
      measured: [counted(15)],
      raises: [{ ...raising, territory: "@fixture/lexer" }],
    });

    expect(decisions).toStrictEqual([]);
    expect(refusals.map(({ weakening }) => weakening)).toStrictEqual([
      { after: 15, before: 14, ratchet: anyCount, territory: parser },
    ]);
  });

  it("judges nothing a ratchet has no baseline for yet", () => {
    expect(
      judgeRatchets({
        ask,
        baselines: [],
        measured: [counted(15)],
        raises: [],
      })
    ).toStrictEqual({ decisions: [], refusals: [] });
  });

  it("judges each territory against its own baseline", () => {
    const lexer = "@fixture/lexer";

    const { refusals } = judgeRatchets({
      ask,
      baselines: [counted(14), counted(2, lexer)],
      measured: [counted(14), counted(3, lexer)],
      raises: [],
    });

    expect(refusals.map(({ weakening }) => weakening)).toStrictEqual([
      { after: 3, before: 2, ratchet: anyCount, territory: lexer },
    ]);
  });
});
