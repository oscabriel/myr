import { describe, expect, it } from "@effect/vitest";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { RatchetName } from "@repo/protocol/ids";
import { Weakened } from "@repo/protocol/refusal";
import { Option } from "effect";

import type { RatchetCount } from "../src/facts.ts";
import { ratchet } from "../src/stages/ratchet.ts";
import { addedLines, ask, testFacts, wire } from "./facts.ts";

const escapes = RatchetName.make("escapes");

const week = "packages/parse/src/week.ts";

const pad = "packages/format/src/pad.ts";

const reasoned = "// oxlint-disable-next-line no-x -- the parser's one cast";

/** The escapes ratchet in the parse module, from `before` to `after`. */
const counted = (before: number, after: number) =>
  new Map<RatchetName, RatchetCount>([
    [escapes, { after, before, territory: "@datekit/parse" }],
  ]);

describe("ratchet: a raised count is refused, or waits for a decider", () => {
  it("lets a push through that keeps or lowers every ratchet", () => {
    const { decisions, refusals } = ratchet(
      testFacts({
        addedLines: addedLines([week, 4, reasoned]),
        ratchetCounts: counted(3, 2),
      })
    );

    expect([decisions, refusals]).toStrictEqual([[], []]);
  });

  it("refuses a raise that no reasoned escape accounts for", () => {
    const { decisions, refusals } = ratchet(
      testFacts({ ratchetCounts: counted(3, 4) })
    );

    expect(decisions).toStrictEqual([]);
    expect(wire(refusals)).toStrictEqual(
      wire([
        new Weakened({
          weakening: {
            after: 4,
            before: 3,
            ratchet: escapes,
            territory: "@datekit/parse",
          },
        }),
      ])
    );
  });

  it("asks a decider about a raise that a reasoned escape in its territory makes", () => {
    const { decisions, refusals } = ratchet(
      testFacts({
        addedLines: addedLines([week, 4, reasoned]),
        ratchetCounts: counted(3, 4),
      })
    );

    expect(refusals).toStrictEqual([]);
    expect(decisions).toStrictEqual([
      DecisionSubject.cases.RaiseRatchet.make({
        after: 4,
        ask: ask.id,
        before: 3,
        ratchet: escapes,
        territory: "@datekit/parse",
      }),
    ]);
  });

  it("refuses a raise whose only reasoned escape is in another territory", () => {
    const { decisions, refusals } = ratchet(
      testFacts({
        addedLines: addedLines([pad, 4, reasoned]),
        ratchetCounts: counted(3, 4),
      })
    );

    expect(decisions).toStrictEqual([]);
    expect(refusals.map((refusal) => refusal._tag)).toStrictEqual(["Weakened"]);
  });

  it("refuses a raise on a decider's own landing, which has no ask to wait on", () => {
    const { decisions, refusals } = ratchet(
      testFacts({
        addedLines: addedLines([week, 4, reasoned]),
        ask: Option.none(),
        ratchetCounts: counted(3, 4),
      })
    );

    expect(decisions).toStrictEqual([]);
    expect(refusals.map((refusal) => refusal._tag)).toStrictEqual(["Weakened"]);
  });
});
