import { describe, expect, it } from "@effect/vitest";
import { Verdict } from "@repo/protocol/domain/answer";
import { Outcome } from "@repo/protocol/domain/outcome";
import { CheckVersion, LaneName, PatchId, TreeSha } from "@repo/protocol/ids";
import { DateTime, Option, Result, Schema } from "effect";

import { verdictOf } from "../src/verdict.ts";
import type { VerdictInput } from "../src/verdict.ts";
import { ask, base, head, testFacts } from "./facts.ts";

const now = DateTime.makeUnsafe("2026-10-07T15:30:00.000Z");

const input: VerdictInput = {
  checkVersion: CheckVersion.make("redThenGreen@0.0.0+0a1b2c3d4e5f6a7b"),
  facts: testFacts(),
  heldBack: [],
  lanes: [
    {
      command: "bun run test",
      durationMs: 4210,
      lane: LaneName.make("unit"),
      result: "passed",
    },
  ],
  now,
  outcome: Outcome.cases.Checking.make({ stage: "heldBack" }),
  patchId: PatchId.make("ab".repeat(32)),
  stage: "checks",
  tree: TreeSha.make("5555555555555555555555555555555555555555"),
};

describe(verdictOf, () => {
  it("records the run on the answer, and decodes as a Verdict", () => {
    const verdict = verdictOf(input);

    const wire = Result.map(verdict, Schema.encodeSync(Verdict));

    expect(wire).toStrictEqual(
      Result.succeed({
        ask: "iso-week",
        at: "2026-10-07T15:30:00.000Z",
        base,
        checkVersion: "redThenGreen@0.0.0+0a1b2c3d4e5f6a7b",
        head,
        heldBack: [],
        lanes: [
          {
            command: "bun run test",
            durationMs: 4210,
            lane: "unit",
            result: "passed",
          },
        ],
        outcome: Schema.encodeSync(Outcome)(input.outcome),
        patchId: "ab".repeat(32),
        project: ask.project,
        stage: "checks",
        tree: "5555555555555555555555555555555555555555",
        verifier: "platform",
      })
    );
    expect(
      Result.map(wire, (each) => Schema.decodeSync(Verdict)(each))
    ).toStrictEqual(verdict);
  });

  it("is NoAsk for a push that answers no ask", () => {
    const verdict = verdictOf({
      ...input,
      facts: testFacts({ ask: Option.none() }),
    });

    expect(
      Result.match(verdict, {
        onFailure: (refusal) => refusal._tag,
        onSuccess: () => "a verdict",
      })
    ).toBe("NoAsk");
  });
});
