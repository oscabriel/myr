import { describe, expect, it } from "@effect/vitest";
import { RatchetMeasure, RatchetSpec } from "@repo/protocol/domain/check";
import { Command } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { RatchetName, RepoPath } from "@repo/protocol/ids";
import { Option } from "effect";

import {
  escapeDecisions,
  escapeRatchet,
  explainedRaises,
} from "../src/escapes.ts";
import { addedLines, ask, policy, testFacts } from "./facts.ts";

const week = "packages/parse/src/week.ts";

const lex = "packages/parse/src/lex.ts";

const pad = "packages/format/src/pad.ts";

const cast =
  "// oxlint-disable-next-line no-explicit-any -- the parser's one cast";

const generated = "/* eslint-disable no-console -- generated tables */";

const parseEscapes = RatchetName.make("escapes-datekit-parse");

const waiver = (path: string, line: number, marker: string, reason: string) =>
  DecisionSubject.cases.Waiver.make({
    ask: ask.id,
    at: { line, path: RepoPath.make(path) },
    marker,
    reason,
  });

describe(escapeRatchet, () => {
  it.each([
    ["@datekit/parse", "escapes-datekit-parse"],
    ["packages/parser", "escapes-packages-parser"],
    ["Parse_Kit", "escapes-parse-kit"],
    [".", "escapes-root"],
  ])("names %s's escape ratchet %s", (territory, name) => {
    expect(escapeRatchet(territory)).toBe(name);
  });
});

describe(escapeDecisions, () => {
  it("asks a maintainer about a reasoned escape in a territory with none yet", () => {
    expect(
      escapeDecisions(testFacts({ addedLines: addedLines([week, 4, cast]) }))
    ).toStrictEqual([
      waiver(week, 4, "oxlint-disable", "the parser's one cast"),
    ]);
  });

  it("asks about every reasoned escape in a territory the push raises", () => {
    expect(
      escapeDecisions(
        testFacts({
          addedLines: addedLines([week, 9, generated], [week, 4, cast]),
          ratchetBaselines: new Map([[parseEscapes, 1]]),
        })
      )
    ).toStrictEqual([
      waiver(week, 4, "oxlint-disable", "the parser's one cast"),
      waiver(week, 9, "eslint-disable", "generated tables"),
    ]);
  });

  it("asks nothing when the baseline already covers the territory's escapes after the push", () => {
    // A maintainer accepted a waiver for this answer: the baseline rose to 3
    // while main still holds 2, so the answer, checked again, is within it.
    expect(
      escapeDecisions(
        testFacts({
          addedLines: addedLines([week, 4, cast]),
          escapeCounts: new Map([[parseEscapes, 2]]),
          ratchetBaselines: new Map([[parseEscapes, 3]]),
        })
      )
    ).toStrictEqual([]);
  });

  it("asks nothing when the push removes as many escapes from the territory as it adds", () => {
    expect(
      escapeDecisions(
        testFacts({
          addedLines: addedLines([week, 4, cast]),
          ratchetBaselines: new Map([[parseEscapes, 1]]),
          removedLines: addedLines([lex, 12, generated]),
        })
      )
    ).toStrictEqual([]);
  });

  it("counts a removed escape only against its own territory", () => {
    expect(
      escapeDecisions(
        testFacts({
          addedLines: addedLines([week, 4, cast]),
          ratchetBaselines: new Map([
            [escapeRatchet("@datekit/format"), 1],
            [parseEscapes, 1],
          ]),
          removedLines: addedLines([pad, 3, generated], [lex, 7, "// x"]),
        })
      )
    ).toStrictEqual([
      waiver(week, 4, "oxlint-disable", "the parser's one cast"),
    ]);
  });

  it("asks nothing about a marker with no reason, which shape refuses", () => {
    expect(
      escapeDecisions(
        testFacts({ addedLines: addedLines([week, 4, "// @ts-ignore"]) })
      )
    ).toStrictEqual([]);
  });

  it("asks nothing for a push that answers no ask", () => {
    expect(
      escapeDecisions(
        testFacts({
          addedLines: addedLines([week, 4, cast]),
          ask: Option.none(),
        })
      )
    ).toStrictEqual([]);
  });
});

describe(explainedRaises, () => {
  const anyCount = RatchetName.make("no-explicit-any");

  const bundleKb = RatchetName.make("bundle-kb");

  const declaring = {
    ...policy,
    ratchets: [
      RatchetSpec.make({
        measure: RatchetMeasure.cases.Count.make({
          command: Command.make("oxlint --format json"),
          rule: "typescript/no-explicit-any",
        }),
        name: anyCount,
      }),
      RatchetSpec.make({
        measure: RatchetMeasure.cases.Count.make({
          command: Command.make("oxlint --format json"),
          rule: "import/max-dependencies",
        }),
        name: bundleKb,
      }),
    ],
  };

  it("asks to raise every declared ratchet in each reasoned escape's territory, for its reason", () => {
    expect(
      explainedRaises(declaring, ask, [
        waiver(week, 4, "oxlint-disable", "the parser's one cast"),
        waiver(pad, 2, "eslint-disable", "generated tables"),
      ])
    ).toStrictEqual([
      {
        ratchet: anyCount,
        reason: "the parser's one cast",
        territory: "@datekit/parse",
      },
      {
        ratchet: bundleKb,
        reason: "the parser's one cast",
        territory: "@datekit/parse",
      },
      {
        ratchet: anyCount,
        reason: "generated tables",
        territory: "@datekit/format",
      },
      {
        ratchet: bundleKb,
        reason: "generated tables",
        territory: "@datekit/format",
      },
    ]);
  });

  it("asks nothing of a project that declares no ratchets", () => {
    expect(
      explainedRaises(policy, ask, [
        waiver(week, 4, "oxlint-disable", "the parser's one cast"),
      ])
    ).toStrictEqual([]);
  });
});
