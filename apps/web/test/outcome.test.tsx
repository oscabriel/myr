import { describe, expect, it } from "@effect/vitest";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { StageName } from "@repo/protocol/domain/outcome";
import {
  AskId,
  DecisionId,
  Handle,
  LandedSha,
  RepoPath,
} from "@repo/protocol/ids";
import { OutOfScope, Weakened } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { Schema } from "effect";
import type { ReactElement } from "react";

import {
  OutcomeView,
  StageStrip,
  stageStates,
} from "../src/features/shared/outcome.tsx";
import { RefusalView } from "../src/features/shared/refusal.tsx";
import { allInOrder, markupOf, textOf } from "./markup.ts";

const stagesOf = (element: ReactElement) =>
  [...markupOf(element).matchAll(/<li\b[^>]*>/gu)].flatMap(([tag]) => {
    const stage = /data-stage="(?<value>[^"]+)"/u.exec(tag)?.groups?.value;
    const state = /data-state="(?<value>[^"]+)"/u.exec(tag)?.groups?.value;

    return stage === undefined || state === undefined ? [] : [[stage, state]];
  });

const handle = Schema.decodeSync(Handle);

const repoPath = Schema.decodeSync(RepoPath);

const outOfScope = new OutOfScope({
  paths: [repoPath("packages/format/src/format.ts"), repoPath("README.md")],
});

const weakened = new Weakened({
  at: { line: 12, path: repoPath("packages/parse/test/parse.test.ts") },
  weakening: { marker: ".skip(" },
});

const refusals = [outOfScope, weakened] as const;

const sha = Schema.decodeSync(LandedSha)(
  "9b1c3e5d7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c"
);

const landed = Outcome.cases.Landed.make({ sha });

describe(RefusalView, () => {
  it("shows every line explain gives, in order, and each refusal's tag, with no command to copy beside them", () => {
    const element = <RefusalView refusals={refusals} />;
    const text = textOf(element);

    const expected = refusals.flatMap((refusal) =>
      explain([refusal]).map((line) => line.trim())
    );

    expect(allInOrder(text, expected)).toBeTruthy();
    expect(text).toContain("OutOfScope");
    expect(text).toContain("Weakened");
    expect(markupOf(element)).not.toContain("<button");
  });

  it("points at the path and line of a refusal that has one", () => {
    const text = textOf(<RefusalView refusals={[weakened]} />);

    expect(text).toContain("packages/parse/test/parse.test.ts:12");
  });

  it("says whether retrying can help, without rewording the refusal", () => {
    const markup = markupOf(<RefusalView refusals={refusals} />);

    expect(markup).toContain('data-refusal="OutOfScope"');
    expect(markup).toContain('data-retryable="false"');
  });
});

describe(OutcomeView, () => {
  const waiting = [
    [Outcome.cases.Checking.make({ stage: "checks" }), "Checking", "checks"],
    [
      Outcome.cases.AwaitingDecision.make({
        decision: Schema.decodeSync(DecisionId)("dec-000001"),
      }),
      "Waiting on decision",
      "dec-000001",
    ],
    [
      Outcome.cases.AwaitingFinish.make({ decider: handle("okonkwo") }),
      "waiting for a maintainer's finish",
      "okonkwo",
    ],
    [
      Outcome.cases.WaitingOnParent.make({
        ask: Schema.decodeSync(AskId)("split-format"),
      }),
      "waiting for",
      "split-format",
    ],
  ] as const;

  it.each(waiting)(
    "reads %o as waiting, never as a refusal",
    (outcome, wording, names) => {
      const element = <OutcomeView outcome={outcome} />;

      expect(markupOf(element)).toContain(`data-outcome="${outcome._tag}"`);
      expect(markupOf(element)).toContain('data-state="waiting"');
      expect(markupOf(element)).not.toContain("text-refused");
      expect(textOf(element)).toContain(wording);
      expect(textOf(element)).toContain(names);
    }
  );

  it("reads a landing as final, with its short sha", () => {
    const element = <OutcomeView outcome={landed} />;

    expect(markupOf(element)).toContain('data-state="final"');
    expect(textOf(element)).toContain("Landed as 9b1c3e5");
  });

  it("shows a refusal through RefusalView", () => {
    const element = (
      <OutcomeView outcome={Outcome.cases.Refused.make({ refusals })} />
    );

    expect(markupOf(element)).toContain('data-state="final"');
    expect(markupOf(element)).toContain(
      markupOf(<RefusalView refusals={refusals} />)
    );
  });
});

const strip = (stage: StageName, outcome: Outcome) =>
  stagesOf(<StageStrip outcome={outcome} stage={stage} />);

describe(StageStrip, () => {
  it("marks the stages before the current one passed, and the rest pending", () => {
    expect(
      strip("checks", Outcome.cases.Checking.make({ stage: "checks" }))
    ).toStrictEqual([
      ["parse", "passed"],
      ["shape", "passed"],
      ["merge", "passed"],
      ["cheap", "passed"],
      ["checks", "current"],
      ["heldBack", "pending"],
      ["human", "pending"],
    ]);
  });

  it("marks the stage that refused, and leaves the rest unreached", () => {
    expect(
      strip("shape", Outcome.cases.Refused.make({ refusals }))
    ).toStrictEqual([
      ["parse", "passed"],
      ["shape", "refused"],
      ["merge", "pending"],
      ["cheap", "pending"],
      ["checks", "pending"],
      ["heldBack", "pending"],
      ["human", "pending"],
    ]);
  });

  it("marks a landed answer's later stages as not needed", () => {
    expect(strip("checks", landed)).toStrictEqual([
      ["parse", "passed"],
      ["shape", "passed"],
      ["merge", "passed"],
      ["cheap", "passed"],
      ["checks", "passed"],
      ["heldBack", "skipped"],
      ["human", "skipped"],
    ]);
  });

  it("marks the stage the gate is at as the current step, and gives each state a word at the floor size", () => {
    const markup = markupOf(
      <StageStrip
        outcome={Outcome.cases.Checking.make({ stage: "checks" })}
        stage="checks"
      />
    );

    expect(markup).toMatch(
      /<li\b[^>]*aria-current="step"[^>]*data-stage="checks"/u
    );
    expect(markup.match(/aria-current=/gu)).toHaveLength(1);
    expect(textOf(<StageStrip outcome={landed} stage="checks" />)).toContain(
      "not needed"
    );
    expect(markup).not.toContain("text-xs");
  });

  it("lays the seven stages in rows of four and three on a phone, each name whole: no hyphenation, no break inside a word", () => {
    const markup = markupOf(<StageStrip outcome={landed} stage="checks" />);

    const list = /<ol\b[^>]*>/u.exec(markup)?.[0] ?? "";

    expect(list).toContain(" grid-cols-4");
    expect(list).toContain("tablet:grid-cols-7");

    const names = [...markup.matchAll(/<span\b[^>]*data-term=""[^>]*>/gu)].map(
      ([tag]) => tag
    );

    expect(names).toHaveLength(7);
    expect(
      names.filter(
        (tag) =>
          !(tag.includes("[hyphens:none]") && tag.includes("whitespace-nowrap"))
      )
    ).toStrictEqual([]);
    expect(names.some((tag) => tag.includes("break-words"))).toBeFalsy();
  });

  it("draws a stage the answer never needed as not needed, given what the verdict holds", () => {
    expect(
      stagesOf(
        <StageStrip
          holds={{ decided: false, heldBack: false }}
          outcome={landed}
          stage="human"
        />
      )
    ).toStrictEqual([
      ["parse", "passed"],
      ["shape", "passed"],
      ["merge", "passed"],
      ["cheap", "passed"],
      ["checks", "passed"],
      ["heldBack", "skipped"],
      ["human", "skipped"],
    ]);
  });
});

describe("each stage's state", () => {
  it("marks the maintainer and held-back stages of a landing that needed neither as not needed", () => {
    expect(
      stageStates("human", landed, { decided: false, heldBack: false })
    ).toStrictEqual([
      ["parse", "passed"],
      ["shape", "passed"],
      ["merge", "passed"],
      ["cheap", "passed"],
      ["checks", "passed"],
      ["heldBack", "skipped"],
      ["human", "skipped"],
    ]);
  });

  it("marks them passed when the verdict holds a decision and held-back results", () => {
    expect(
      stageStates("human", landed, { decided: true, heldBack: true })
    ).toStrictEqual([
      ["parse", "passed"],
      ["shape", "passed"],
      ["merge", "passed"],
      ["cheap", "passed"],
      ["checks", "passed"],
      ["heldBack", "passed"],
      ["human", "passed"],
    ]);
  });

  it("keeps a stage the answer still waits at current, whatever the verdict holds", () => {
    expect(
      stageStates(
        "human",
        Outcome.cases.AwaitingFinish.make({ decider: handle("okonkwo") }),
        { decided: false, heldBack: false }
      )
    ).toStrictEqual([
      ["parse", "passed"],
      ["shape", "passed"],
      ["merge", "passed"],
      ["cheap", "passed"],
      ["checks", "passed"],
      ["heldBack", "skipped"],
      ["human", "current"],
    ]);
  });

  it("reads as before when it is not told what the verdict holds", () => {
    expect(stageStates("human", landed)).toStrictEqual([
      ["parse", "passed"],
      ["shape", "passed"],
      ["merge", "passed"],
      ["cheap", "passed"],
      ["checks", "passed"],
      ["heldBack", "passed"],
      ["human", "passed"],
    ]);
  });
});
