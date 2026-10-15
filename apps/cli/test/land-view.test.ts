import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import type { Land } from "@repo/protocol/contracts";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  CommitSha,
  LandedSha,
  ProjectName,
  RequestId,
} from "@repo/protocol/ids";
import { StaleBase } from "@repo/protocol/refusal";
import { Option } from "effect";

import { refusalsIn, views } from "../src/render.ts";

const base = CommitSha.make("4c2e6a8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c");

const head = CommitSha.make("9f1e3d5c7b9a1f3e5d7c9b1a3f5e7d9c1b3a5f7e");

const main = LandedSha.make("2b4d6f8a0c2e4a6c8e0b2d4f6a8c0e2b4d6f8a0c");

type Receipt = typeof Land.successSchema.Type;

const receiptWith = (outcome: Outcome): Receipt => ({
  base,
  head,
  outcome,
  project: ProjectName.make("alice/datekit"),
  requestId: RequestId.make("land-alice-01"),
});

const textOf = (receipt: Receipt) =>
  Option.match(views.land(receipt), {
    onNone: () => "",
    onSome: ({ markdown, text }) => text ?? markdown,
  });

describe("a land's receipt", () => {
  it("while its checks run, says so and how to follow it with the same request", () => {
    expect(
      textOf(receiptWith(Outcome.cases.Checking.make({ stage: "merge" })))
    ).toBe(
      `checking 9f1e3d5 (merge); follow with the same \`${Brand.cli} land\`, --requestId land-alice-01 and all, which checks nothing twice`
    );
  });

  it("once it lands, names the landing", () => {
    expect(textOf(receiptWith(Outcome.cases.Landed.make({ sha: main })))).toBe(
      "9f1e3d5: landed as 2b4d6f8"
    );
  });

  it("refused, is the command's refusal, as finish's is", () => {
    const stale = new StaleBase({ base, conflicts: [], main });

    expect(
      refusalsIn(receiptWith(Outcome.cases.Refused.make({ refusals: [stale] })))
    ).toStrictEqual([stale]);
  });
});
