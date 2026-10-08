/**
 * The answer page: the latest verdict on an ask's answer, stage by stage.
 * The gate's stages in a strip, each lane's result and time, held-back
 * checks only as one line per area (its counts and suite root, nothing
 * more), the outcome, and a refusal as `git push` printed it. A landed
 * answer shows its landing's credit trailers and the commit.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Outcome } from "@repo/protocol/domain/outcome";
import { AreaName } from "@repo/protocol/ids";
import { ChecksFailed, HeldBackFailed } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";

import {
  AnswerView,
  HeldBackBits,
  LaneTable,
} from "../src/features/answer/answer-page.tsx";
import {
  inOrder,
  landedSha,
  landing,
  markupOf,
  now,
  suite,
  textOf,
  verdictOf,
} from "./ask-fixtures.ts";

const checksFailed = new ChecksFailed({
  lane: "unit",
  logRef: "logs/datekit/parse-iso-week/unit",
  next: `${Brand.cli} evidence logs/datekit/parse-iso-week/unit`,
});

const heldBackFailed = new HeldBackFailed({ area: "export", suite });

const refused = verdictOf(
  Outcome.cases.Refused.make({ refusals: [checksFailed, heldBackFailed] })
);

/** Each element that names a stage, as `[stage, state]`. */
const stagesOf = (markup: string) =>
  [...markup.matchAll(/<li\b[^>]*>/gu)].flatMap(([tag]) => {
    const stage = /data-stage="(?<value>[^"]+)"/u.exec(tag)?.groups?.value;
    const state = /data-state="(?<value>[^"]+)"/u.exec(tag)?.groups?.value;

    return stage === undefined || state === undefined ? [] : [[stage, state]];
  });

/** Each lane row, as `[lane, result]`. */
const lanesOf = (markup: string) =>
  [...markup.matchAll(/<tr\b[^>]*>/gu)].flatMap(([tag]) => {
    const lane = /data-lane="(?<value>[^"]+)"/u.exec(tag)?.groups?.value;
    const result = /data-result="(?<value>[^"]+)"/u.exec(tag)?.groups?.value;

    return lane === undefined || result === undefined ? [] : [[lane, result]];
  });

describe(AnswerView, () => {
  const page = <AnswerView now={now} verdict={refused} />;

  it("shows the stages the answer passed, the one that refused it, and the ones it never reached", () => {
    expect(stagesOf(markupOf(page))).toStrictEqual([
      ["parse", "passed"],
      ["shape", "passed"],
      ["merge", "passed"],
      ["cheap", "passed"],
      ["checks", "refused"],
      ["heldBack", "pending"],
      ["human", "pending"],
    ]);
  });

  it("shows each lane with its result", () => {
    expect(lanesOf(markupOf(page))).toStrictEqual([
      ["lint", "passed"],
      ["unit", "failed"],
    ]);
    expect(
      inOrder(textOf(page), ["lint", "passed", "unit", "failed"])
    ).toBeTruthy();
  });

  it("shows held-back checks only as an area's counts and its suite root", () => {
    expect(textOf(page)).toContain(`export 6/7 @ ${suite}`);
  });

  it("shows the refusals' explain lines in order, as git printed them", () => {
    expect(
      inOrder(
        textOf(page),
        explain([checksFailed, heldBackFailed]).map((line) => line.trim())
      )
    ).toBeTruthy();
  });

  it("never shows where a lane's log is kept outside the refusal that names it", () => {
    const passing = verdictOf(Outcome.cases.Checking.make({ stage: "checks" }));

    expect(textOf(<AnswerView now={now} verdict={passing} />)).not.toContain(
      "logs/datekit"
    );
  });

  it("names the answer it judged and when", () => {
    const text = textOf(page);

    expect(text).toContain("bbbbbbb");
    expect(text).toContain("aaaaaaa");
    expect(text).toContain("redThenGreen@0.0.0+5e1d");
    expect(text).toContain("20 min ago");
  });

  it("says plainly when no answer has been checked yet", () => {
    const text = textOf(<AnswerView now={now} verdict={undefined} />);

    expect(text).toContain("No answer to this ask has been checked yet");
    expect(text).not.toContain("Parse");
  });

  it("shows a landed answer's credit trailers in trailer order, its held-back trailer, and its commit", () => {
    const landed = verdictOf(Outcome.cases.Landed.make({ sha: landedSha }));
    const element = <AnswerView landing={landing} now={now} verdict={landed} />;
    const text = textOf(element);

    expect(text).toContain("Landed as 9b1c3e5");
    expect(
      inOrder(text, ["Asked-by: ines-v", "Signed-off-by: okafor"])
    ).toBeTruthy();
    expect(text).toContain(`Held-back: export 7/7 @ ${suite}`);
    expect(text).toContain("Assisted-by: claude-code:opus-5 (verified)");
    expect(text).toContain(`git show ${landedSha}`);
  });
});

describe(LaneTable, () => {
  it("gives each lane's command and how long it ran", () => {
    const { lanes } = refused;
    const text = textOf(<LaneTable lanes={lanes} />);

    expect(inOrder(text, ["lint", "bun run lint", "1.2 s"])).toBeTruthy();
    expect(inOrder(text, ["unit", "bun test", "8.3 s"])).toBeTruthy();
  });

  it("says when no lane ran", () => {
    expect(textOf(<LaneTable lanes={[]} />)).toContain("No lane ran");
  });
});

describe(HeldBackBits, () => {
  it("shows one line per area, and nothing else about the held-back checks", () => {
    const results = [
      { area: AreaName.make("export"), passed: 6, suite, total: 7 },
      { area: AreaName.make("parse"), passed: 3, suite, total: 3 },
    ];

    expect(textOf(<HeldBackBits results={results} />).trim()).toBe(
      `export 6/7 @ ${suite} parse 3/3 @ ${suite}`
    );
  });
});
