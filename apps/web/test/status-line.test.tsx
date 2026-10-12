import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import type { Ask } from "@repo/protocol/domain/ask";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import { Outcome } from "@repo/protocol/domain/outcome";
import { DraftState } from "@repo/protocol/domain/proposal";
import type { Proposal } from "@repo/protocol/domain/proposal";
import {
  AskId,
  DecisionId,
  Handle,
  LandedSha,
  LaneName,
  ProposalId,
  RepoPath,
} from "@repo/protocol/ids";
import { OutOfScope, Weakened } from "@repo/protocol/refusal";
import { explain, headline } from "@repo/protocol/render";
import { DateTime } from "effect";
import type { ReactElement } from "react";

import { StatusLine } from "../src/features/shared/status-line.tsx";
import type { StatusSubject } from "../src/features/shared/status-line.tsx";
import { ask as parseIsoWeek, now, project } from "./ask-fixtures.ts";
import { markupOf, textOf } from "./markup.ts";

const tamsin = Handle.make("tamsin");

const okonkwo = Handle.make("okonkwo");

const formatOrdinal: Ask = {
  ...parseIsoWeek,
  id: AskId.make("format-ordinal"),
  mentor: okonkwo,
  reserve: "newcomers",
};

const claim = `${Brand.cli} claim format-ordinal --project ${project}`;

const refusals = [
  new OutOfScope({ paths: [RepoPath.make("README.md")] }),
  new Weakened({
    at: { line: 12, path: RepoPath.make("test/parse.test.ts") },
    weakening: { marker: ".skip(" },
  }),
] as const;

const decision: Decision = {
  deciders: [Handle.make("ines-v"), okonkwo],
  default: "decline",
  evidence: [],
  expiresAt: DateTime.add(now, { hours: 3 }),
  id: DecisionId.make("dec-000001"),
  openedAt: DateTime.subtract(now, { hours: 21 }),
  project,
  subject: DecisionSubject.cases.Vouch.make({ handle: tamsin }),
};

const proposal: Proposal = {
  expiresAt: DateTime.add(now, { days: 6 }),
  files: [],
  id: ProposalId.make("prop-000001"),
  openedAt: DateTime.subtract(now, { days: 1 }),
  project,
  proposer: tamsin,
  state: "open",
  want: "Format durations in words",
};

const rendered = (element: ReactElement) => {
  const markup = markupOf(element);

  return {
    markup,
    tone: /data-tone="(?<tone>[^"]+)"/u.exec(markup)?.groups?.tone,
    text: textOf(element),
  };
};

const line = (subject: StatusSubject, command?: string) =>
  rendered(
    command === undefined ? (
      <StatusLine subject={subject} />
    ) : (
      <StatusLine command={command} subject={subject} />
    )
  );

describe(StatusLine, () => {
  it("says an open ask the viewer may take is open to take, who it is held for, and the claim", () => {
    const { markup, text, tone } = line(
      { ask: formatOrdinal, kind: "ask", takeable: true },
      claim
    );

    expect(text).toContain("Open to take");
    expect(text).toContain("held for newcomers, mentored by okonkwo");
    expect(markup).toMatch(new RegExp(`<code\\b[^>]*>${claim}</code>`, "u"));
    expect(tone).toBe("muted");
  });

  it("says who holds a claimed ask that has no answer yet, and that it is their move", () => {
    const { text, tone } = line({
      ask: { ...formatOrdinal, state: "claimed" },
      claimant: tamsin,
      kind: "ask",
      takeable: false,
    });

    expect(text).toContain("Claimed by tamsin, no answer pushed yet");
    expect(text).toContain("tamsin's move");
    expect(tone).toBe("ink");
  });

  it("says an answer under check is the platform's move, in the checking role", () => {
    const { text, tone } = line({
      kind: "answer",
      outcome: Outcome.cases.Checking.make({ stage: "checks" }),
    });

    expect(text).toContain("Checking at the checks stage");
    expect(text).toContain("the platform's move");
    expect(tone).toBe("checking");
  });

  it("names a refusal by its headline and stage, leaves it to the answerer, and never paraphrases it", () => {
    const { text, tone } = line(
      {
        claimant: tamsin,
        kind: "answer",
        outcome: Outcome.cases.Refused.make({ refusals }),
        stage: "shape",
      },
      `${Brand.cli} check`
    );

    expect(text).toContain(`Refused at Shape: ${headline(refusals)}`);
    expect(text).toContain("tamsin's move");
    expect(text).toContain(`${Brand.cli} check`);
    expect(tone).toBe("refused");

    for (const words of explain(refusals).slice(1)) {
      expect(text).not.toContain(words.trim());
    }
  });

  it("gives a waiting answer's sentence as the rehearsal reads it, never in the refused role", () => {
    const waiting = [
      [
        Outcome.cases.AwaitingDecision.make({
          decision: DecisionId.make("dec-000001"),
        }),
        "Waiting on decision dec-000001",
        "a decider's move",
      ],
      [
        Outcome.cases.AwaitingFinish.make({ decider: okonkwo }),
        "Passed, waiting for a decider's finish from okonkwo",
        "okonkwo's move",
      ],
      [
        Outcome.cases.WaitingOnParent.make({
          ask: AskId.make("drop-legacy-fetch-burrow-kit"),
        }),
        "Passed, waiting for drop-legacy-fetch-burrow-kit to land first",
        // The ask it waits on may be no family's: the move is that ask's.
        "that ask's move",
      ],
    ] as const;

    for (const [outcome, sentence, move] of waiting) {
      const { markup, text, tone } = line({ kind: "answer", outcome });

      expect(text).toContain(sentence);
      expect(text).toContain(move);
      expect(tone).toBe("waiting");
      expect(markup).not.toContain("text-refused");
    }
  });

  it("says a landing in the form the rehearsal checks, with no one's move after it", () => {
    const { text, tone } = line({
      kind: "answer",
      outcome: Outcome.cases.Landed.make({
        sha: LandedSha.make("e7fb8a9d1c3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a"),
      }),
    });

    expect(text).toContain("Landed as e7fb8a9");
    expect(text).not.toContain("move");
    expect(tone).toBe("landed");
  });

  it("says an open ask that still waits on others is waiting, as its row says, never open", () => {
    const { text, tone } = line({
      ask: { ...formatOrdinal, blockedBy: [AskId.make("split-a")] },
      kind: "ask",
      takeable: false,
    });

    expect(text).toContain("Waiting");
    expect(text).not.toContain("Open");
    expect(tone).toBe("waiting");
  });

  it("says what a delete child waits on in its family's terms", () => {
    const { text, tone } = line({
      ask: {
        ...formatOrdinal,
        blockedBy: ["a", "b", "c", "d", "e", "f"].map((name) =>
          AskId.make(`split-${name}`)
        ),
        state: "waitingOnParent",
      },
      blockers: {
        children: [],
        landed: 2,
        total: 6,
      },
      kind: "ask",
      takeable: false,
    });

    expect(text).toContain("Waiting for 4 of 6 children to land");
    expect(text).toContain("the family's move");
    expect(tone).toBe("waiting");
  });

  it("says when a decision expires, its default, and that it is the viewer's move when they decide", () => {
    const yours = line({
      decision,
      kind: "decision",
      now,
      viewerDecides: true,
    });

    const theirs = line({
      decision,
      kind: "decision",
      now,
      viewerDecides: false,
    });

    expect(yours.text).toContain("Expires in 3 h");
    expect(yours.text).toContain("default: decline");
    expect(yours.text).toContain("your move");
    expect(yours.tone).toBe("waiting");
    expect(theirs.text).toContain("a decider's move");
  });

  it("says a decided decision's choice, in the landed role only when it took effect", () => {
    const accepted = line({
      decision: {
        ...decision,
        decided: { at: now, by: okonkwo, choice: "accept" },
      },
      kind: "decision",
      now,
      viewerDecides: true,
    });

    const declined = line({
      decision: {
        ...decision,
        decided: { at: now, by: okonkwo, choice: "decline" },
      },
      kind: "decision",
      now,
      viewerDecides: true,
    });

    expect(accepted.text).toContain("Accepted by okonkwo");
    expect(accepted.tone).toBe("landed");
    expect(declined.text).toContain("Declined by okonkwo");
    expect(declined.tone).toBe("ink");
  });

  it("says where a proposal's draft stands in the outcome's words", () => {
    const drafting = line({
      kind: "proposal",
      proposal: {
        ...proposal,
        draft: DraftState.cases.Drafting.make({ round: 1, startedAt: now }),
      },
    });

    const ready = line({
      kind: "proposal",
      proposal: {
        ...proposal,
        draft: DraftState.cases.Ready.make({
          attempts: 1,
          model: "a-model",
          red: { lane: LaneName.make("unit"), signature: "expected 1" },
          round: 1,
        }),
      },
    });

    expect(drafting.text).toContain("Drafting");
    expect(drafting.tone).toBe("checking");
    expect(ready.text).toContain("Ready, waits for a decider");
    expect(ready.tone).toBe("waiting");
  });

  it("draws only the mark and the lead word in its compact form", () => {
    const { text } = rendered(
      <StatusLine
        compact
        subject={{
          kind: "answer",
          outcome: Outcome.cases.Landed.make({
            sha: LandedSha.make("e".repeat(40)),
          }),
        }}
      />
    );

    expect(text).toBe("Landed");
  });
});
