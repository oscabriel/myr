/**
 * Today, as a decider reads it: decisions, not diffs, against the day's
 * budget. Each decision says in plain words what it is about, what happens
 * if nobody decides (its own `default`) and when, and offers only the
 * choices its subject allows. Rendered to HTML with `react-dom/server`.
 */
import { describe, expect, it } from "@effect/vitest";
import { RefNameText } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision, Today } from "@repo/protocol/domain/decision";
import type { LandingView } from "@repo/protocol/domain/landing";
import {
  AskId,
  CommitSha,
  DecisionId,
  EnvKey,
  Handle,
  LandedSha,
  ProjectName,
  ProposalId,
  RatchetName,
  RepoPath,
} from "@repo/protocol/ids";
import { NotDecider } from "@repo/protocol/refusal";
import { Cause, DateTime } from "effect";
import { AsyncResult } from "effect/reactivity";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { allowedChoices } from "../src/features/decision/decision-card.tsx";
import { RefusalView } from "../src/features/shared/refusal.tsx";
import {
  orderDecisions,
  TodayView,
} from "../src/features/today/today-page.tsx";

/** The entities React writes for text, and what each reads as. */
const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["&#x27;", "'"],
  ["&amp;", "&"],
  ["&gt;", ">"],
  ["&lt;", "<"],
  ["&quot;", '"'],
]);

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

/** What a reader sees: the markup without its tags, entities decoded. */
const textOf = (element: ReactElement) =>
  markupOf(element)
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(
      /&(?:#x27|amp|gt|lt|quot);/gu,
      (entity) => ENTITIES.get(entity) ?? entity
    )
    .replaceAll(/\s+/gu, " ");

/** Each decision card's id, in the order the page lists them. */
const cardsOf = (element: ReactElement) =>
  [...markupOf(element).matchAll(/data-decision="(?<id>[^"]+)"/gu)].map(
    (match) => match.groups?.id
  );

/** The choices each card offers, as `id: choice choice`. */
const choicesOf = (element: ReactElement) => {
  const markup = markupOf(element);

  return [...markup.matchAll(/data-decision="(?<id>[^"]+)"/gu)].map(
    (match, index, all) => {
      const end = all[index + 1]?.index ?? markup.length;
      const card = markup.slice(match.index, end);

      const choices = [
        ...card.matchAll(/data-choice="(?<choice>[^"]+)"/gu),
      ].map((each) => each.groups?.choice);

      return `${match.groups?.id}: ${choices.join(" ")}`;
    }
  );
};

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const at = (iso: string) => DateTime.makeUnsafe(iso);

const sha = (digit: string) => CommitSha.make(digit.repeat(40));

const okonkwo = Handle.make("okonkwo");

const datekit = ProjectName.make("datekit");

const burrow = ProjectName.make("burrow");

/** A stray push to datekit's main, expiring in 22 hours: soon. */
const stray: Decision = {
  deciders: [okonkwo],
  default: "revert",
  evidence: [{ label: "pushed by", value: "a token outside the platform" }],
  expiresAt: at("2026-10-08T10:00:00Z"),
  id: DecisionId.make("dec-000002"),
  openedAt: at("2026-10-06T10:00:00Z"),
  project: datekit,
  subject: DecisionSubject.cases.StrayPush.make({
    after: sha("b"),
    before: sha("a"),
    ref: RefNameText.make("refs/heads/main"),
  }),
};

/** A vouch for lin-h, expiring in two days. */
const vouch: Decision = {
  deciders: [okonkwo],
  default: "decline",
  evidence: [{ label: "first claim", value: "format-date" }],
  expiresAt: at("2026-10-09T12:00:00Z"),
  id: DecisionId.make("dec-000003"),
  openedAt: at("2026-10-06T12:00:00Z"),
  project: datekit,
  subject: DecisionSubject.cases.Vouch.make({ handle: Handle.make("lin-h") }),
};

/** A proposal in burrow, expiring last. */
const proposal: Decision = {
  deciders: [okonkwo],
  default: "decline",
  evidence: [{ label: "want", value: "Dates parse in every locale." }],
  expiresAt: at("2026-10-10T09:00:00Z"),
  id: DecisionId.make("dec-000001"),
  openedAt: at("2026-10-05T09:00:00Z"),
  project: burrow,
  subject: DecisionSubject.cases.OpenProposal.make({
    proposal: ProposalId.make("prop-000004"),
  }),
};

const landing = (
  digit: string,
  ask: string,
  landedAt: string
): LandingView => ({
  ask: AskId.make(ask),
  assisted: [],
  author: Handle.make("ines-v"),
  credits: [{ handle: Handle.make("ines-v"), role: "Signed-off-by" }],
  landedAt: at(landedAt),
  project: datekit,
  sha: LandedSha.make(digit.repeat(40)),
});

const today: Today = {
  budget: { finishes: 1, total: 5, used: 2 },
  decider: okonkwo,
  // Out of order on purpose: the page orders them.
  decisions: [proposal, vouch, stray],
  expiringSoon: [stray.id],
  newcomers: [Handle.make("lin-h")],
  overflow: 4,
  unattended: [
    landing("c", "format-date", "2026-10-07T09:00:00Z"),
    landing("d", "parse-iso", "2026-10-06T18:00:00Z"),
  ],
};

const page = (
  <TodayView
    now={now}
    onDecide={() => {}}
    result={AsyncResult.success(today)}
  />
);

describe(TodayView, () => {
  it("counts decisions against the budget and finishes apart", () => {
    const text = textOf(page);

    expect(text).toContain("2 of 5");
    expect(text).toContain("1 finish");
    expect(text).not.toContain("3 of 5");
  });

  it("lists the decision expiring soon first, then the rest by expiry", () => {
    expect(cardsOf(page)).toStrictEqual([
      "dec-000002",
      "dec-000003",
      "dec-000001",
    ]);
  });

  it("says what happens if nobody decides, from the decision's own default, and when it expires", () => {
    const text = textOf(page);

    expect(text).toContain("If nobody decides by Thu 8 Oct, 10:00 UTC: revert");
    expect(text).toContain(
      "If nobody decides by Fri 9 Oct, 12:00 UTC: decline"
    );
    expect(markupOf(page)).toContain('dateTime="2026-10-08T10:00:00.000Z"');
    expect(text).toContain("in 22 h");
  });

  it("takes the default's word from the decision, never from its subject", () => {
    const adopting = { ...stray, default: "adopt" } as const;

    const text = textOf(
      <TodayView
        now={now}
        onDecide={() => {}}
        result={AsyncResult.success({ ...today, decisions: [adopting] })}
      />
    );

    expect(text).toContain("If nobody decides by Thu 8 Oct, 10:00 UTC: adopt");
  });

  it("says how many more wait for tomorrow", () => {
    expect(textOf(page)).toContain("4 more wait for tomorrow");
  });

  it("names the newcomers to welcome and the landings that needed nobody", () => {
    const text = textOf(page);
    const markup = markupOf(page);

    expect(markup).toContain('href="/people/lin-h"');
    expect(text).toContain("format-date");
    expect(text).toContain("parse-iso");
    expect(text).toContain("cccccc");
  });

  it("offers each decision only the choices its subject allows", () => {
    expect(choicesOf(page)).toStrictEqual([
      "dec-000002: adopt revert",
      "dec-000003: accept decline",
      "dec-000001: accept decline",
    ]);
  });

  it("shows a NotDecider failure as the refusal, not an empty page", () => {
    const refused = new NotDecider({});

    const markup = markupOf(
      <TodayView
        now={now}
        onDecide={() => {}}
        result={AsyncResult.failure(Cause.fail(refused))}
      />
    );

    expect(markup).toContain(markupOf(<RefusalView refusals={[refused]} />));
    expect(markup).not.toContain("data-decision");
  });
});

describe(orderDecisions, () => {
  it("puts the decisions expiring soon first, then the rest by expiry", () => {
    expect(orderDecisions(today).map(({ id }) => id)).toStrictEqual([
      "dec-000002",
      "dec-000003",
      "dec-000001",
    ]);
  });

  it("tells apart two projects' decisions that share an id, by which one expires within the day", () => {
    const elsewhere = { ...stray, expiresAt: at("2026-10-11T10:00:00Z") };
    const other = { ...elsewhere, project: burrow };

    const merged = {
      ...today,
      decisions: [proposal, other, vouch, stray],
      expiringSoon: [stray.id],
    };

    expect(
      orderDecisions(merged).map(({ id, project }) => `${project}/${id}`)
    ).toStrictEqual([
      "datekit/dec-000002",
      "datekit/dec-000003",
      "burrow/dec-000001",
      "burrow/dec-000002",
    ]);
  });
});

describe(allowedChoices, () => {
  const ask = AskId.make("parse-iso");

  const subjects = [
    stray.subject,
    vouch.subject,
    proposal.subject,
    DecisionSubject.cases.Finish.make({ ask, head: sha("e") }),
    DecisionSubject.cases.RaiseRatchet.make({
      after: 3,
      ask,
      before: 2,
      ratchet: RatchetName.make("no-explicit-any"),
      territory: "packages/format",
    }),
    DecisionSubject.cases.Waiver.make({
      ask,
      at: { line: 12, path: RepoPath.make("src/parse.test.ts") },
      marker: ".skip(",
      reason: "flaky on leap days",
    }),
    DecisionSubject.cases.PostureChange.make({ from: "open", to: "openCore" }),
    DecisionSubject.cases.SecretInTree.make({
      ask,
      item: EnvKey.make("SENTRY_DSN"),
    }),
    DecisionSubject.cases.ProxyWidened.make({
      hosts: [],
      item: EnvKey.make("SENTRY_DSN"),
    }),
  ];

  it("lets a stray push be adopted or reverted, and anything else accepted or declined", () => {
    expect(
      subjects.map((subject) => [subject._tag, allowedChoices(subject)])
    ).toStrictEqual([
      ["StrayPush", ["adopt", "revert"]],
      ["Vouch", ["accept", "decline"]],
      ["OpenProposal", ["accept", "decline"]],
      ["Finish", ["accept", "decline"]],
      ["RaiseRatchet", ["accept", "decline"]],
      ["Waiver", ["accept", "decline"]],
      ["PostureChange", ["accept", "decline"]],
      ["SecretInTree", ["accept", "decline"]],
      ["ProxyWidened", ["accept", "decline"]],
    ]);
  });
});
