import { describe, expect, it } from "@effect/vitest";
import { StageName } from "@repo/protocol/domain/outcome";

import {
  BEATS,
  CYCLE,
  LOOP,
  REST,
  poseAt,
} from "../src/features/landing/music-box/model.ts";
import { refusedPush } from "../src/features/landing/transcript.ts";

/** The stage that refuses the first answer, as the transcript's refusal does. */
const REFUSING = StageName.literals.indexOf("shape");

/** Every tenth of a second of one cycle. */
const CYCLE_TIMES = Array.from(
  { length: CYCLE * 10 },
  (_, index) => index / 10
);

/** When a stage's flag first reads checking for the second answer. */
const firstChecked = (stage: number) =>
  CYCLE_TIMES.find(
    (time) => time > BEATS[3] + 2 && poseAt(time).flags[stage] === "checking"
  ) ?? Number.POSITIVE_INFINITY;

describe(poseAt, () => {
  it("is a pure function of time that loops", () => {
    expect(poseAt(7.3)).toStrictEqual(poseAt(7.3));
    expect(poseAt(7.3 + LOOP).readout).toBe(poseAt(7.3).readout);
    expect(poseAt(7.3 + LOOP).flags).toStrictEqual(poseAt(7.3).flags);
  });

  it("refuses the first answer at the shape stage with the tag the transcript prints", () => {
    const refused = poseAt(BEATS[3]);
    const { tag } = refusedPush("https://platform.example");

    expect(refused.flags[REFUSING]).toBe("refused");
    expect(refused.flags.slice(0, REFUSING)).toStrictEqual(["landed"]);
    expect(
      refused.flags.slice(REFUSING + 1).every((flag) => flag === "idle")
    ).toBeTruthy();
    expect(refused.readout).toBe(`round 1 · refused · ${tag}`);
  });

  it("passes the second answer through every stage in order, cheapest first", () => {
    const order = StageName.literals.map((_, stage) => firstChecked(stage));

    expect(order).toStrictEqual(order.toSorted((a, b) => a - b));
    expect(order.every(Number.isFinite)).toBeTruthy();
  });

  it("reports the held-back stage by one bit in the sealed colour, and every other stage as passed", () => {
    const { flags } = poseAt(REST);

    expect(flags).toStrictEqual(
      StageName.literals.map((stage) =>
        stage === "heldBack" ? "sealed" : "landed"
      )
    );
  });

  it("lets the press hold an answer only once every stage has passed it", () => {
    const held = CYCLE_TIMES.filter((time) => poseAt(time).holding);
    const lastStage = StageName.literals.length - 1;

    expect(held.length).toBeGreaterThan(0);
    expect(
      held.every((time) => poseAt(time).flags[lastStage] === "landed")
    ).toBeTruthy();
  });

  it("rests with the refused answer in its tray and the second landed", () => {
    const rest = poseAt(REST);

    expect(rest.drop).toBe(1);
    expect(rest.slip).toBeGreaterThan(0.9);
    expect(rest.fixed).toBe(1);
    expect(rest.readout).toMatch(/^landed · tooth \d+ plays true$/u);
  });
});
