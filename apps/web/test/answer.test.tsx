import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import type { Verdict } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { StageName } from "@repo/protocol/domain/outcome";
import { AreaName, AskId, CommitSha, DecisionId } from "@repo/protocol/ids";
import {
  ChecksFailed,
  HeldBackFailed,
  UnknownAsk,
  UnknownCommit,
} from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { asTester, unanswered } from "@repo/protocol/testing";
import { isNotFound } from "@tanstack/react-router";
import { Effect, Layer, Ref, Schema, Stream } from "effect";
import { RpcTest } from "effect/rpc";

import {
  AnswerView,
  durationText,
  HeldBackBits,
} from "../src/features/answer/answer-page.tsx";
import { readAnswer } from "../src/features/answer/reads.ts";
import { askStates } from "../src/features/shared/ask-progress.ts";
import { Refusals } from "../src/features/shared/refusals.ts";
import {
  ask,
  askId,
  brief,
  claimedEvent,
  decidedLanding,
  family,
  inOrder,
  judgedEvent,
  landedSha,
  landing,
  markupOf,
  now,
  plainLanding,
  plainText,
  project,
  suite,
  textOf,
  verdictOf,
} from "./ask-fixtures.ts";
import { textIn } from "./markup.ts";
import { elementWith } from "./records.ts";

const checksFailed = new ChecksFailed({
  lane: "unit",
  logRef: "logs/datekit/parse-iso-week/unit",
  next: `${Brand.cli} evidence logs/datekit/parse-iso-week/unit`,
});

const heldBackFailed = new HeldBackFailed({ area: "export", suite });

const refused = verdictOf(
  Outcome.cases.Refused.make({ refusals: [checksFailed, heldBackFailed] })
);

const stagesOf = (markup: string) =>
  [...markup.matchAll(/<li\b[^>]*>/gu)].flatMap(([tag]) => {
    const stage = /data-stage="(?<value>[^"]+)"/u.exec(tag)?.groups?.value;
    const state = /data-state="(?<value>[^"]+)"/u.exec(tag)?.groups?.value;

    return stage === undefined || state === undefined ? [] : [[stage, state]];
  });

const lanesOf = (markup: string) =>
  [...markup.matchAll(/<[a-z]+\b[^>]*data-lane="[^"]*"[^>]*>/gu)].flatMap(
    ([tag]) => {
      const lane = /data-lane="(?<value>[^"]+)"/u.exec(tag)?.groups?.value;
      const result = /data-result="(?<value>[^"]+)"/u.exec(tag)?.groups?.value;

      return lane === undefined || result === undefined ? [] : [[lane, result]];
    }
  );

const commitLinksOf = (markup: string) =>
  [
    ...markup.matchAll(
      /<a\b[^>]*href="(?<href>[^"]*\/commit\/[^"]*)"[^>]*>(?<inner>.*?)<\/a>/gu
    ),
  ].flatMap(({ groups }) =>
    groups?.href === undefined || groups.inner === undefined
      ? []
      : [[groups.href, plainText(groups.inner).trim()]]
  );

const heroOf = (markup: string) =>
  /<section aria-label="Outcome"[^>]*>(?<inner>.*?)<\/section>/su.exec(markup)
    ?.groups?.inner ?? "";

const runOf = (markup: string) =>
  markup.slice(markup.indexOf('id="answer-gate"'), markup.indexOf("</main>"));

const mainOf = (markup: string) =>
  /<main\b[^>]*>(?<inner>.*)<\/main>/su.exec(markup)?.groups?.inner ?? "";

const factsOf = (markup: string) => elementWith(markup, 'data-facts="inline"');

const page = (
  props: Partial<Parameters<typeof AnswerView>[0]> & {
    readonly verdict: Verdict | undefined;
  }
) => <AnswerView ask={ask} now={now} {...props} />;

const landedAt = (stage: StageName, heldBack: boolean) => ({
  ...verdictOf(Outcome.cases.Landed.make({ sha: landedSha })),
  heldBack: heldBack
    ? verdictOf(Outcome.cases.Landed.make({ sha: landedSha })).heldBack
    : [],
  stage,
});

describe("the answer page", () => {
  const refusedPage = page({ verdict: refused });

  it("titles the page with the ask's want, and names the project, the ask and the answer in its trail", () => {
    const markup = markupOf(refusedPage);

    expect(markup).toMatch(
      /<h1\b[^>]*>Parse ISO week dates like 2026-W41-3<\/h1>/u
    );
    expect(
      inOrder(textOf(refusedPage), ["datekit", "Asks", askId, "Answer"])
    ).toBeTruthy();
    expect(markup).toContain('href="/oscabriel/datekit"');
    expect(markup).toContain(`href="/oscabriel/datekit/asks/${askId}"`);
  });

  it("leads with the outcome: the first heading after the title is the hero, and a landing links its commit", () => {
    const landed = landedAt("human", true);
    const markup = markupOf(page({ landing: decidedLanding, verdict: landed }));
    const afterTitle = markup.slice(markup.indexOf("</h1>"));

    const hero =
      /<section aria-label="Outcome"[^>]*>(?<inner>.*?)<\/section>/su.exec(
        afterTitle
      );

    expect(hero).not.toBeNull();
    expect(afterTitle.indexOf('<section aria-label="Outcome"')).toBeLessThan(
      afterTitle.indexOf("<h2")
    );
    expect(plainText(hero?.groups?.inner ?? "")).toContain("Landed as 9b1c3e5");
    expect(hero?.groups?.inner).toContain(
      `href="/oscabriel/datekit/commit/${landedSha}"`
    );
  });

  it("puts what was judged last in main, after the outcome and the gate, and only there", () => {
    const markup = markupOf(refusedPage);
    const main = mainOf(markup);
    const strip = main.indexOf('data-stage="human"');

    expect(strip).toBeGreaterThan(main.indexOf('aria-label="Outcome"'));
    expect(main.lastIndexOf("Patch id")).toBeGreaterThan(strip);
    expect(main.lastIndexOf("Merged tree")).toBeGreaterThan(strip);
    expect(factsOf(markup)).not.toContain("Patch id");
  });

  it("shows the stages the answer passed, the one that refused it, and the ones it never reached", () => {
    expect(stagesOf(mainOf(markupOf(refusedPage)))).toStrictEqual([
      ["parse", "passed"],
      ["shape", "passed"],
      ["merge", "passed"],
      ["cheap", "passed"],
      ["checks", "refused"],
      ["heldBack", "pending"],
      ["human", "pending"],
    ]);
  });

  it("reads the maintainer and held-back stages as not needed for a landing that needed neither", () => {
    const markup = markupOf(
      page({ landing: plainLanding, verdict: landedAt("human", false) })
    );

    expect(stagesOf(mainOf(markup)).slice(5)).toStrictEqual([
      ["heldBack", "skipped"],
      ["human", "skipped"],
    ]);
    expect(
      textOf(page({ landing: plainLanding, verdict: landedAt("human", false) }))
    ).toContain("not needed");
  });

  it("reads them passed for a landing a maintainer finished and held-back checks judged", () => {
    const markup = markupOf(
      page({ landing: decidedLanding, verdict: landedAt("human", true) })
    );

    expect(stagesOf(mainOf(markup)).slice(5)).toStrictEqual([
      ["heldBack", "passed"],
      ["human", "passed"],
    ]);
  });

  it("opens failed lanes first, each with the command that reads its log, and folds the passed ones into a line", () => {
    const markup = markupOf(refusedPage);
    const text = textOf(refusedPage);

    expect(lanesOf(mainOf(markup))).toStrictEqual([
      ["unit", "failed"],
      ["lint", "passed"],
    ]);
    expect(text).toContain(
      `${Brand.cli} evidence logs/datekit/parse-iso-week/unit --project oscabriel/datekit`
    );
    expect(text).toContain("1 lane passed in 1.2 s");
    expect(
      /<details\b[^>]*>.*data-lane="lint".*<\/details>/su.test(mainOf(markup))
    ).toBeTruthy();
    expect(inOrder(text, ["unit", "bun test", "failed", "8.3 s"])).toBeTruthy();
  });

  it("keeps each passed lane's command and how long it ran inside the folded line", () => {
    const folded =
      /<details\b[^>]*>(?<inner>.*)<\/details>/su.exec(
        mainOf(markupOf(refusedPage))
      )?.groups?.inner ?? "";

    expect(
      inOrder(plainText(folded), ["lint", "bun run lint", "passed", "1.2 s"])
    ).toBeTruthy();
  });

  it("says no lane has run yet while the answer is checking, and that none ran once it was refused before them", () => {
    const checking = {
      ...verdictOf(Outcome.cases.Checking.make({ stage: "cheap" })),
      lanes: [],
      stage: "cheap" as const,
    };

    const refusedEarly = { ...refused, lanes: [], stage: "shape" as const };

    expect(textOf(page({ verdict: checking }))).toContain(
      "No lane has run yet."
    );
    expect(textOf(page({ verdict: checking }))).not.toContain("No lane ran");
    expect(textOf(page({ verdict: refusedEarly }))).toContain(
      "No lane ran on this answer."
    );
  });

  it("names the ask and the round right under the title, before the outcome", () => {
    const states = askStates([
      claimedEvent(1, "okafor"),
      judgedEvent(2, refused.outcome),
    ]);

    const markup = mainOf(markupOf(page({ states, verdict: refused })));
    const round = markup.indexOf("round 1 of 1");

    expect(round).toBeGreaterThan(markup.indexOf("</h1>"));
    expect(round).toBeLessThan(markup.indexOf('aria-label="Outcome"'));
  });

  it("gives no claim command for an ask that still waits on others to land", () => {
    const blocked = { ...ask, blockedBy: [AskId.make("split-format")] };
    const markup = mainOf(markupOf(page({ ask: blocked, verdict: undefined })));

    expect(textIn(markup)).not.toContain(`${Brand.cli} claim`);
    expect(textIn(markup)).toContain("waits for 1 ask to land first");
    expect(markup).toContain(`href="/oscabriel/datekit/asks/${askId}"`);
  });

  it("reads a family's parent, open but waiting on its children, as waiting, never as open to take", () => {
    const blocked = { ...ask, blockedBy: [AskId.make("split-format")] };
    const markup = markupOf(page({ ask: blocked, verdict: undefined }));

    expect(markup).not.toContain(">Open to take<");
    expect(markup).toMatch(/<strong\b[^>]*>Waiting<\/strong>/u);
    // An ask nothing blocks is open to take, as before.
    expect(markupOf(page({ verdict: undefined }))).toContain(">Open to take<");
  });

  it("names a lane's log only as the command that reads it", () => {
    const passing = verdictOf(Outcome.cases.Checking.make({ stage: "checks" }));
    const text = textOf(page({ verdict: passing }));

    const mentions = [
      ...text.matchAll(/logs\/datekit\/parse-iso-week\/unit/gu),
    ];

    expect(mentions.length).toBeGreaterThan(0);

    for (const { index } of mentions) {
      expect(text.slice(index - `${Brand.cli} evidence `.length, index)).toBe(
        `${Brand.cli} evidence `
      );
    }
  });

  it("shows held-back checks only as an area's counts and its suite root, shortened, the whole root in its title", () => {
    const bits =
      /<ul aria-label="Held-back checks by area"[^>]*>(?<inner>.*?)<\/ul>/su.exec(
        markupOf(refusedPage)
      )?.groups?.inner;

    expect(plainText(bits ?? "").trim()).toBe("export 6/7 @ sha256:4f2a4f…");
    expect(bits).toContain(`title="${suite}"`);
  });

  it("reads an answer's rounds first in main, newest first, the one on the page selected, and leaves them out of its facts", () => {
    const states = askStates([
      claimedEvent(1, "okafor"),
      judgedEvent(2, refused.outcome, CommitSha.make("e".repeat(40))),
      judgedEvent(3, refused.outcome),
    ]);

    const markup = markupOf(page({ states, verdict: refused }));
    const main = mainOf(markup);
    const rounds = main.slice(main.indexOf('id="answer-rounds"'));

    expect(main.indexOf('id="answer-rounds"')).toBeGreaterThan(-1);
    expect(main.indexOf('id="answer-rounds"')).toBeLessThan(
      main.indexOf('id="answer-gate"')
    );
    expect(
      inOrder(textIn(rounds), ["Round 2 of 2", "Round 1 of 2"])
    ).toBeTruthy();
    expect(rounds).toMatch(/data-selected="true"[^>]*>[\s\S]*?Round 2 of 2/u);
    expect(textIn(factsOf(markup))).not.toContain("Rounds");
  });

  it("draws no rounds region for an answer's only round", () => {
    const states = askStates([
      claimedEvent(1, "okafor"),
      judgedEvent(2, refused.outcome),
    ]);

    expect(mainOf(markupOf(page({ states, verdict: refused })))).not.toContain(
      'id="answer-rounds"'
    );
  });

  it("tells a waiting answer's contributor there is nothing to run, and what a push would start", () => {
    const waiting = verdictOf(
      Outcome.cases.AwaitingDecision.make({
        decision: DecisionId.make("dec-000001"),
      })
    );

    const states = askStates([
      claimedEvent(1, "okafor"),
      judgedEvent(2, refused.outcome, CommitSha.make("e".repeat(40))),
      judgedEvent(3, waiting.outcome),
    ]);

    expect(
      textIn(mainOf(markupOf(page({ states, verdict: waiting }))))
    ).toContain(
      "Nothing for you to run. Pushing again starts round 3; this verdict stays as round 2."
    );
    expect(textIn(mainOf(markupOf(refusedPage)))).not.toContain(
      "Nothing for you to run."
    );
  });

  it("tells a landing as a sentence, then credits the people at title weight, then links the landing commit", () => {
    const landed = verdictOf(Outcome.cases.Landed.make({ sha: landedSha }));
    const markup = markupOf(page({ landing, verdict: landed }));
    const region = markup.slice(markup.indexOf('id="answer-landing"'));

    expect(
      inOrder(textIn(region), [
        "Landed as 9b1c3e5",
        "asked by ines-v",
        "Credit",
        "Asked-by: ines-v",
        "The landing commit",
      ])
    ).toBeTruthy();
    expect(region).toMatch(/<h3 class="[^"]*text-title[^"]*">Credit<\/h3>/u);
  });

  it("shows the refusals' explain lines in order, as git printed them", () => {
    expect(
      inOrder(
        textOf(refusedPage),
        explain([checksFailed, heldBackFailed]).map((line) => line.trim())
      )
    ).toBeTruthy();
  });

  it("names the answer it judged, its round, and when", () => {
    const states = askStates([
      claimedEvent(1, "okafor"),
      judgedEvent(2, refused.outcome, CommitSha.make("e".repeat(40))),
      judgedEvent(3, refused.outcome),
    ]);

    const element = page({ states, verdict: refused });
    const text = textOf(element);

    for (const shown of [
      "round 2 of 2",
      "bbbbbbb",
      "aaaaaaa",
      "redThenGreen@0.0.0+5e1d",
      "20 min ago",
      "okafor's move",
    ]) {
      expect(text).toContain(shown);
    }
  });

  it("reads a wait on a decision as waiting, in the hero", () => {
    const waiting = verdictOf(
      Outcome.cases.AwaitingDecision.make({
        decision: DecisionId.make("dec-000001"),
      })
    );

    const text = textOf(page({ verdict: waiting }));

    expect(text).toContain("Waiting on decision dec-000001");
  });

  it("gives an ask nobody answered the command that claims it", () => {
    const text = textOf(page({ verdict: undefined }));

    expect(text).toContain("Nobody has answered this ask yet.");
    expect(text).toContain(
      `${Brand.cli} claim ${askId} --project oscabriel/datekit`
    );
    expect(markupOf(page({ verdict: undefined }))).not.toContain("data-stage");
  });

  it("names who holds a claimed ask with no answer pushed, and links back to the ask", () => {
    const states = askStates([claimedEvent(1, "bram")]);
    const element = page({ states, verdict: undefined });
    const main = mainOf(markupOf(element));

    expect(textIn(main)).toContain("Claimed by bram, no answer pushed yet.");
    expect(main).toContain(`href="/oscabriel/datekit/asks/${askId}"`);
  });

  it("shows a landed answer's credit trailers in trailer order, its held-back trailer, and its commit", () => {
    const landed = verdictOf(Outcome.cases.Landed.make({ sha: landedSha }));
    const text = textOf(page({ landing, verdict: landed }));

    expect(text).toContain("Landed as 9b1c3e5");
    expect(
      inOrder(text, ["Asked-by: ines-v", "Signed-off-by: okafor"])
    ).toBeTruthy();
    expect(text).toContain(`Held-back: export 7/7 @ ${suite}`);
    expect(text).toContain("Assisted-by: claude-code:opus-5 (verified)");
    expect(text).toContain(`git show ${landedSha}`);
  });

  it("links a landed answer's landing (from the hero and the landing) and its base to their commit pages", () => {
    const landed = verdictOf(Outcome.cases.Landed.make({ sha: landedSha }));
    const markup = markupOf(page({ landing, verdict: landed }));

    expect(commitLinksOf(heroOf(markup))).toStrictEqual([
      [`/${project}/commit/${landedSha}`, "9b1c3e5"],
    ]);
    expect(commitLinksOf(runOf(markup))).toStrictEqual([
      [`/${project}/commit/${landed.base}`, landed.base.slice(0, 7)],
      [`/${project}/commit/${landedSha}`, "9b1c3e5"],
      [`/${project}/commit/${landedSha}`, "The landing commit"],
    ]);
  });

  it("links neither the head nor the merged tree: they live in the claim's fork", () => {
    const landed = verdictOf(Outcome.cases.Landed.make({ sha: landedSha }));
    const markup = markupOf(page({ landing, verdict: landed }));

    expect(markup).not.toContain(`/commit/${landed.head}`);
    expect(markup).not.toContain(`/commit/${landed.tree}`);
  });

  it("links the base and no landing when the answer has not landed", () => {
    expect(commitLinksOf(heroOf(markupOf(refusedPage)))).toStrictEqual([]);
    expect(commitLinksOf(runOf(markupOf(refusedPage)))).toStrictEqual([
      [`/${project}/commit/${refused.base}`, refused.base.slice(0, 7)],
    ]);
  });

  it("stamps the landed mark only when the page is told the landing came while it was open", () => {
    const landed = landedAt("human", false);

    expect(
      markupOf(page({ landing: plainLanding, stamp: true, verdict: landed }))
    ).toContain("animate-stamp");
    expect(
      markupOf(page({ landing: plainLanding, verdict: landed }))
    ).not.toContain("animate-stamp");
  });

  it("draws a family member's family, the member marked", () => {
    const child = family.child(1);

    const markup = markupOf(
      <AnswerView
        ask={child}
        now={now}
        parent={family.parent}
        verdict={refused}
      />
    );

    expect(factsOf(markup)).toContain(`data-family="${family.parent.id}"`);
    expect(factsOf(markup)).toMatch(
      /aria-current="true"[^>]*title="retire-old-week-parse"|title="retire-old-week-parse"[^>]*aria-current="true"/u
    );
  });
});

describe(HeldBackBits, () => {
  it("shows one line per area, and nothing else about the held-back checks", () => {
    const results = [
      { area: AreaName.make("export"), passed: 6, suite, total: 7 },
      { area: AreaName.make("parse"), passed: 3, suite, total: 3 },
    ];

    expect(textOf(<HeldBackBits results={results} />).trim()).toBe(
      "export 6/7 @ sha256:4f2a4f… parse 3/3 @ sha256:4f2a4f…"
    );
  });
});

describe(durationText, () => {
  it("says how long a lane ran in the unit a person reads", () => {
    expect([640, 8312, 125_000].map(durationText)).toStrictEqual([
      "640 ms",
      "8.3 s",
      "2 min 5 s",
    ]);
  });
});

interface Asked {
  readonly asks: number;
  readonly landings: number;
  readonly replays: number;
  readonly verdicts: number;
}

const replay = [
  claimedEvent(1, "bram"),
  claimedEvent(2, "okafor", AskId.make("format-week")),
  judgedEvent(3, refused.outcome),
];

const count = (asked: Ref.Ref<Asked>, key: keyof Asked) =>
  Ref.update(asked, (seen) => ({ ...seen, [key]: seen[key] + 1 }));

const platformAt = (
  asked: Ref.Ref<Asked>,
  outcome: Outcome,
  landingKnown = true,
  shown: Ask = ask
) =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("verdict", (payload) =>
          Effect.gen(function* () {
            yield* count(asked, "verdicts");

            if (payload.ask !== askId) {
              return yield* new UnknownAsk({ ask: payload.ask });
            }

            return { verdict: verdictOf(outcome) };
          })
        ),
        Contracts.toLayerHandler("showAsk", (payload) =>
          Effect.gen(function* () {
            yield* count(asked, "asks");

            if (payload.ask !== shown.id && payload.ask !== family.parent.id) {
              return yield* new UnknownAsk({ ask: payload.ask });
            }

            return {
              ask: payload.ask === shown.id ? shown : family.parent,
              brief,
            };
          })
        ),
        Contracts.toLayerHandler("watch", () =>
          Stream.fromEffect(count(asked, "replays")).pipe(
            Stream.flatMap(() => Stream.fromIterable(replay))
          )
        ),
        Contracts.toLayerHandler("landing", (payload) =>
          Effect.gen(function* () {
            yield* count(asked, "landings");

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

const nothingAsked: Asked = { asks: 0, landings: 0, replays: 0, verdicts: 0 };

describe(readAnswer, () => {
  it.effect(
    "reads a landed answer's landing with its verdict, its ask and the ask's events",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);
        const landed = Outcome.cases.Landed.make({ sha: landedSha });

        const read = yield* readAnswer({ ask: askId, project }).pipe(
          Effect.provide(platformAt(asked, landed))
        );

        expect({
          events: read.events.map(({ seq }) => seq),
          landing: read.landing?.sha,
          lastSeq: read.lastSeq,
          outcome: read.verdict?.outcome._tag,
          parent: read.parent,
          want: read.askRead.brief.want,
        }).toStrictEqual({
          events: [1, 3],
          landing: landedSha,
          lastSeq: 3,
          outcome: "Landed",
          parent: undefined,
          want: ask.brief.want,
        });
        expect(yield* Ref.get(asked)).toStrictEqual({
          asks: 1,
          landings: 1,
          replays: 1,
          verdicts: 1,
        });
      })
  );

  it.effect("reads a family member's parent, for the family", () =>
    Effect.gen(function* () {
      const asked = yield* Ref.make(nothingAsked);

      const read = yield* readAnswer({ ask: askId, project }).pipe(
        Effect.provide(
          platformAt(asked, refused.outcome, true, {
            ...family.child(0),
            id: askId,
          })
        )
      );

      expect(read.parent?.id).toBe(family.parent.id);
      expect(yield* Ref.get(asked)).toStrictEqual({
        asks: 2,
        landings: 0,
        replays: 1,
        verdicts: 1,
      });
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
      expect((yield* Ref.get(asked)).landings).toBe(0);
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
