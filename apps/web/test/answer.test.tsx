/**
 * The answer page: the latest verdict on an ask's answer, stage by stage.
 * The gate's stages in a strip, each lane's result and time, held-back
 * checks only as one line per area (its counts and suite root, nothing
 * more), the outcome, and a refusal as `git push` printed it. A landed
 * answer shows its landing's credit trailers and the commit.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import { Outcome } from "@repo/protocol/domain/outcome";
import { AreaName, AskId } from "@repo/protocol/ids";
import {
  ChecksFailed,
  HeldBackFailed,
  UnknownAsk,
  UnknownCommit,
} from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { asTester, unanswered } from "@repo/protocol/testing";
import { isNotFound } from "@tanstack/react-router";
import { Effect, Layer, Ref, Schema } from "effect";
import { RpcTest } from "effect/rpc";

import {
  AnswerView,
  HeldBackBits,
  LaneTable,
} from "../src/features/answer/answer-page.tsx";
import { Refusals } from "../src/features/ask/refused.tsx";
import { readAnswer } from "../src/routes/$project/answers/$ask.tsx";
import {
  askId,
  inOrder,
  landedSha,
  landing,
  markupOf,
  now,
  plainText,
  project,
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

/** Each link to a commit page, in page order. */
const commitLinksOf = (markup: string) =>
  [...markup.matchAll(/href="(?<href>[^"]*\/commit\/[^"]*)"/gu)].flatMap(
    ({ groups }) => (groups?.href === undefined ? [] : [groups.href])
  );

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
    const bits =
      /<ul aria-label="Held-back checks by area"[^>]*>(?<inner>.*?)<\/ul>/su.exec(
        markupOf(page)
      )?.groups?.inner;

    expect(plainText(bits ?? "").trim()).toBe(`export 6/7 @ ${suite}`);
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

  it("links a landed answer's landing and its base to their commit pages, and keeps the git show command", () => {
    const landed = verdictOf(Outcome.cases.Landed.make({ sha: landedSha }));

    const markup = markupOf(
      <AnswerView landing={landing} now={now} verdict={landed} />
    );

    expect(commitLinksOf(markup)).toStrictEqual([
      `/${project}/commit/${landed.base}`,
      `/${project}/commit/${landedSha}`,
    ]);
    expect(markup).toContain(`git show ${landedSha}`);
    expect(markup).toContain("The landing commit");
  });

  it("links neither the head nor the merged tree: they live in the claim's fork", () => {
    const landed = verdictOf(Outcome.cases.Landed.make({ sha: landedSha }));

    const markup = markupOf(
      <AnswerView landing={landing} now={now} verdict={landed} />
    );

    expect(markup).not.toContain(`/commit/${landed.head}`);
    expect(markup).not.toContain(`/commit/${landed.tree}`);
  });

  it("links the base and no landing when the answer has not landed", () => {
    expect(commitLinksOf(markupOf(page))).toStrictEqual([
      `/${project}/commit/${refused.base}`,
    ]);
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

/** What the stub platform was asked: verdicts and landings. */
interface Asked {
  readonly landings: number;
  readonly verdicts: number;
}

/**
 * A platform whose datekit ask's latest answer ended in `outcome`, as the
 * answer page's loader calls it; `landingKnown` says whether it still finds
 * the landing a landed verdict names.
 */
const platformAt = (
  asked: Ref.Ref<Asked>,
  outcome: Outcome,
  landingKnown = true
) =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("verdict", (payload) =>
          Effect.gen(function* () {
            yield* Ref.update(asked, (seen) => ({
              ...seen,
              verdicts: seen.verdicts + 1,
            }));

            if (payload.ask !== askId) {
              return yield* new UnknownAsk({ ask: payload.ask });
            }

            return { verdict: verdictOf(outcome) };
          })
        ),
        Contracts.toLayerHandler("landing", (payload) =>
          Effect.gen(function* () {
            yield* Ref.update(asked, (seen) => ({
              ...seen,
              landings: seen.landings + 1,
            }));

            if (!landingKnown || payload.sha !== landedSha) {
              return yield* new UnknownCommit({ sha: payload.sha });
            }

            return { landing };
          })
        )
      ),
      asTester,
    ])
  );

const nothingAsked: Asked = { landings: 0, verdicts: 0 };

describe(readAnswer, () => {
  it.effect("reads a landed answer's landing with its verdict", () =>
    Effect.gen(function* () {
      const asked = yield* Ref.make(nothingAsked);
      const landed = Outcome.cases.Landed.make({ sha: landedSha });

      const read = yield* readAnswer({ ask: askId, project }).pipe(
        Effect.provide(platformAt(asked, landed))
      );

      expect(read.verdict?.outcome._tag).toBe("Landed");
      expect(read.landing?.sha).toBe(landedSha);
      expect(yield* Ref.get(asked)).toStrictEqual({ landings: 1, verdicts: 1 });
    })
  );

  it.effect("asks for no landing when the answer did not land", () =>
    Effect.gen(function* () {
      const asked = yield* Ref.make(nothingAsked);

      const read = yield* readAnswer({ ask: askId, project }).pipe(
        Effect.provide(platformAt(asked, refused.outcome))
      );

      expect(read.verdict?.outcome._tag).toBe("Refused");
      expect(read.landing).toBeUndefined();
      expect(yield* Ref.get(asked)).toStrictEqual({ landings: 0, verdicts: 1 });
    })
  );

  it.effect(
    "shows the verdict alone when the platform no longer finds its landing",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);
        const landed = Outcome.cases.Landed.make({ sha: landedSha });

        const read = yield* readAnswer({ ask: askId, project }).pipe(
          Effect.provide(platformAt(asked, landed, false))
        );

        expect(read.verdict?.outcome._tag).toBe("Landed");
        expect(read.landing).toBeUndefined();
      })
  );

  it.effect(
    "is a not-found carrying the UnknownAsk refusal for an ask the project lacks",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);
        const missing = AskId.make("no-such-ask");

        const failed = yield* Effect.flip(
          readAnswer({ ask: missing, project }).pipe(
            Effect.provide(
              platformAt(
                asked,
                Outcome.cases.Checking.make({ stage: "checks" })
              )
            )
          )
        );

        expect(isNotFound(failed)).toBeTruthy();

        const carried = yield* Schema.decodeUnknownEffect(Refusals)(
          isNotFound(failed) ? failed.data : undefined
        );

        expect(explain(carried)).toStrictEqual(
          explain([new UnknownAsk({ ask: missing })])
        );
      })
  );

  it.effect(
    "is a not-found with no refusal, and asks nothing, when ?head= is not a whole commit id",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);

        const failed = yield* Effect.flip(
          readAnswer({ ask: askId, head: "9b1c3e5", project }).pipe(
            Effect.provide(platformAt(asked, refused.outcome))
          )
        );

        expect(isNotFound(failed)).toBeTruthy();
        expect(
          isNotFound(failed) ? failed.data : "not a not-found"
        ).toBeUndefined();
        expect(yield* Ref.get(asked)).toStrictEqual(nothingAsked);
      })
  );
});
