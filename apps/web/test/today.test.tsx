/**
 * Today, as a decider reads it: decisions, not diffs, against the day's
 * budget, said in one sentence. The decisions sit in sections (due today,
 * then the rest by expiry), each row's link the subject in plain words;
 * then how many wait for tomorrow, the newcomers to welcome and the
 * landings that needed nobody. Every choice says what it does under it.
 * A choice taken leaves its row where it was, reading what it did.
 *
 * Rendered to HTML with `react-dom/server`, and read through the route's
 * loader over the dev world with its fixtures, signed in as a decider.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { RefNameText } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision, Today } from "@repo/protocol/domain/decision";
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
import { DecisionClosed, NotDecider } from "@repo/protocol/refusal";
import { Cause, DateTime, Effect, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  allowedChoices,
  consequenceOf,
  describeSubject,
} from "../src/features/decision/decision-card.tsx";
import { RefusalView } from "../src/features/shared/refusal.tsx";
import { readToday } from "../src/features/today/read.ts";
import {
  budgetSentence,
  orderDecisions,
  TodayPageData,
  TodayRead,
  TodayView,
} from "../src/features/today/today-page.tsx";
import { Route, todayHeaders } from "../src/routes/today.tsx";
import { fixturesClient } from "./dev-client.ts";

/** The entities React writes for text, and what each reads as. */
const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["&#x27;", "'"],
  ["&amp;", "&"],
  ["&gt;", ">"],
  ["&lt;", "<"],
  ["&quot;", '"'],
]);

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

/** What a reader sees of `markup`: the text without its tags, entities decoded. */
const textIn = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(
      /&(?:#x27|amp|gt|lt|quot);/gu,
      (entity) => ENTITIES.get(entity) ?? entity
    )
    .replaceAll(/\s+/gu, " ");

const textOf = (element: ReactElement) => textIn(markupOf(element));

/** Each row's markup, by the decision it stands for, in the order the page lists them: from its `<li>` to the next row or the end of its list. */
const rowsOf = (markup: string) => {
  const starts = [
    ...markup.matchAll(/<li[^>]*data-decision="(?<id>[^"]+)"[^>]*>/gu),
  ];

  return starts.map((match, index) => {
    const start = match.index;
    const listEnd = markup.indexOf("</ul></section>", start);
    const next = starts[index + 1]?.index ?? markup.length;

    return {
      body: markup.slice(
        start,
        listEnd === -1 ? next : Math.min(next, listEnd)
      ),
      id: match.groups?.id ?? "",
    };
  });
};

/** The choices each row offers, as `id: choice choice`. */
const choicesOf = (markup: string) =>
  rowsOf(markup).map(
    ({ body, id }) =>
      `${id}: ${[...body.matchAll(/data-choice="(?<choice>[^"]+)"/gu)]
        .map((each) => each.groups?.choice)
        .join(" ")}`
  );

/** The section headers, in the order the page shows them. */
const sectionsOf = (markup: string) => {
  const main = markup.includes("<aside")
    ? markup.slice(0, markup.indexOf("<aside"))
    : markup;

  return [...main.matchAll(/<h2[^>]*>(?<name>[^<]+)<\/h2>/gu)].map(
    (match) => match.groups?.name
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

const viewOf = (
  read: TodayRead,
  extra: Partial<Parameters<typeof TodayView>[0]> = {}
) => <TodayView now={now} onDecide={() => {}} read={read} {...extra} />;

const page = viewOf(TodayRead.cases.Read.make({ today }));

describe(TodayView, () => {
  it("says the budget as one sentence, the finishes counted apart", () => {
    const text = textOf(page);

    expect(text).toContain(
      "Decisions: 2 taken, 3 left today. Finishes are counted apart: 1 taken."
    );
    expect(markupOf(page)).toContain('data-budget="2/5"');
    expect(text).not.toContain("2 of 5");
    expect(text).not.toContain("3 of 5");
  });

  it("says none when no finish was taken", () => {
    expect(budgetSentence({ finishes: 0, total: 5, used: 5 })).toBe(
      "Decisions: 5 taken, none left today. Finishes are counted apart: none taken."
    );
  });

  it("puts its sections in order, each under its header", () => {
    expect(sectionsOf(markupOf(page))).toStrictEqual([
      "Due today",
      "Within your budget",
      "Waits for tomorrow",
      "Newcomers to welcome",
      "Landed without a decision",
    ]);
  });

  it("lists the decision expiring soon first, then the rest by expiry", () => {
    expect(rowsOf(markupOf(page)).map(({ id }) => id)).toStrictEqual([
      "dec-000002",
      "dec-000003",
      "dec-000001",
    ]);
  });

  it("links each row by its subject in plain words, never by its id", () => {
    const links = [
      ...markupOf(page).matchAll(
        /<a[^>]*data-list-key="(?<key>[^"]+)"[^>]*>(?<text>[^<]*)<\/a>/gu
      ),
    ].flatMap((match) =>
      match.groups?.key?.includes("/dec-") === true
        ? [[match.groups.key, textIn(match.groups.text ?? "")]]
        : []
    );

    expect(links).toStrictEqual([
      [
        "datekit/dec-000002",
        "main moved without a landing, from aaaaaaa to bbbbbbb",
      ],
      ["datekit/dec-000003", "Vouch for lin-h, so they may claim asks"],
      ["burrow/dec-000001", "Open the ask proposed in prop-000004"],
    ]);
  });

  it("says when each expires and its default at the row's end", () => {
    const [first] = rowsOf(markupOf(page));

    expect(textIn(first?.body ?? "")).toContain("in 22 h");
    expect(textIn(first?.body ?? "")).toContain("default: revert");
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
      viewOf(
        TodayRead.cases.Read.make({
          today: { ...today, decisions: [adopting] },
        })
      )
    );

    expect(text).toContain("If nobody decides by Thu 8 Oct, 10:00 UTC: adopt");
  });

  it("says how many more wait for tomorrow", () => {
    const markup = markupOf(page);

    expect(textIn(markup)).toContain("4 more wait for tomorrow");
    expect(markup).toContain('data-overflow="4"');
    expect(
      textOf(
        viewOf(TodayRead.cases.Read.make({ today: { ...today, overflow: 3 } }))
      )
    ).toContain("3 more wait for tomorrow");
  });

  it("names the newcomers to welcome and the landings that needed nobody", () => {
    const text = textOf(page);
    const markup = markupOf(page);

    expect(markup).toContain('href="/people/lin-h"');
    expect(text).toContain("format-date");
    expect(text).toContain("parse-iso");
    expect(text).toContain("ccccccc");
  });

  it("offers each decision only the choices its subject allows", () => {
    expect(choicesOf(markupOf(page))).toStrictEqual([
      "dec-000002: adopt revert",
      "dec-000003: accept decline",
      "dec-000001: accept decline",
    ]);
  });

  it("says under every choice what it does", () => {
    for (const { body } of rowsOf(markupOf(page))) {
      const choices = [...body.matchAll(/data-choice="(?<c>[^"]+)"/gu)].map(
        (match) => match.groups?.c
      );

      const lines = [...body.matchAll(/data-consequence="(?<c>[^"]+)"/gu)].map(
        (match) => match.groups?.c
      );

      expect(lines).toStrictEqual(choices);
    }

    expect(textOf(page)).toContain(
      "Opens the ask: its file and check land on main, with you as Decided-by."
    );
    expect(textOf(page)).toContain("The proposal closes; nothing lands.");
  });

  it("keeps a decision taken in its row, reading what it did, and offers its choices no more", () => {
    const taken: Decision = {
      ...proposal,
      decided: { at: now, by: okonkwo, choice: "accept" },
    };

    const markup = markupOf(
      viewOf(
        TodayRead.cases.Read.make({
          today: {
            ...today,
            budget: { ...today.budget, used: 3 },
            decisions: [vouch, stray],
          },
        }),
        { decided: AsyncResult.success({ decision: taken }) }
      )
    );

    const rows = rowsOf(markup);
    const last = rows.at(-1);

    expect(rows.map(({ id }) => id)).toStrictEqual([
      "dec-000002",
      "dec-000003",
      "dec-000001",
    ]);
    expect(textIn(last?.body ?? "")).toContain("Accepted");
    expect(textIn(last?.body ?? "")).toContain(
      "Opens the ask: its file and check land on main, with you as Decided-by."
    );
    expect(last?.body).not.toContain("data-choice=");
    expect(textIn(markup)).toContain("Decisions: 3 taken, 2 left today.");
  });

  it("shows a NotDecider failure as the refusal, says what Today is, and lists no decision", () => {
    const refused = new NotDecider({});

    const markup = markupOf(
      viewOf(TodayRead.cases.Refused.make({ refusal: refused }))
    );

    expect(markup).toContain(markupOf(<RefusalView refusals={[refused]} />));
    expect(markup).not.toContain("data-decision");
    expect(textIn(markup)).toContain(`${Brand.cli} today`);
  });

  it("signed out, says what Today is in one sentence, links to sign in, and gives the command", () => {
    const markup = markupOf(viewOf(TodayRead.cases.SignedOut.make({})));
    const text = textIn(markup);

    expect(text).toContain("Today is a decider's page");
    expect(markup).toMatch(
      /<a[^>]*href="\/auth\/signin[^"]*"[^>]*>Sign in<\/a>/u
    );
    expect(text).toContain(`${Brand.cli} today`);
    expect(markup).not.toContain("data-decision");
  });

  it("shows a DecisionClosed refusal the decider's choice came back with", () => {
    const closed = new DecisionClosed({ decision: stray.id });

    const markup = markupOf(
      viewOf(TodayRead.cases.Read.make({ today }), {
        decided: AsyncResult.failure(Cause.fail(closed)),
      })
    );

    expect(markup).toContain(markupOf(<RefusalView refusals={[closed]} />));
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

describe(allowedChoices, () => {
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

describe(describeSubject, () => {
  it("says each subject in one plain sentence, in the glossary's words", () => {
    expect(subjects.map(describeSubject)).toStrictEqual([
      "main moved without a landing, from aaaaaaa to bbbbbbb",
      "Vouch for lin-h, so they may claim asks",
      "Open the ask proposed in prop-000004",
      "Finish the passing answer to parse-iso, at eeeeeee",
      "Raise the no-explicit-any ratchet in packages/format from 2 to 3, for the answer to parse-iso",
      "Allow .skip( at src/parse.test.ts:12 in the answer to parse-iso: flaky on leap days",
      "Change the project's posture from open to openCore",
      "A stored value of SENTRY_DSN turned up in the answer to parse-iso, which is held aside",
      "Let SENTRY_DSN be sent to more hosts through the platform's proxy",
    ]);
  });
});

describe(consequenceOf, () => {
  it("says what each choice on each subject does, as the platform does it", () => {
    expect(
      subjects.map((subject) =>
        allowedChoices(subject).map((choice: Choice) =>
          consequenceOf(subject, choice)
        )
      )
    ).toStrictEqual([
      [
        "main stays at bbbbbbb, kept as a landing with you as Decided-by.",
        "A landing puts back the tree at aaaaaaa, with you as Decided-by.",
      ],
      [
        "Lands lin-h in the vouch file, with you as Decided-by.",
        "Nothing lands; lin-h stays unvouched.",
      ],
      [
        "Opens the ask: its file and check land on main, with you as Decided-by.",
        "The proposal closes; nothing lands.",
      ],
      [
        "Lands the answer as it is, with you as Finished-by.",
        "Nothing lands; the answer keeps waiting for a finish.",
      ],
      [
        "The answer goes on through the gate with the ratchet at 3, with you as Decided-by.",
        "The answer is refused; the ratchet stays at 2.",
      ],
      [
        "The answer goes on through the gate with .skip( allowed there, with you as Decided-by.",
        "The answer is refused at that line.",
      ],
      [
        "The answer that changes it goes on through the gate, with you as Decided-by.",
        "The answer that changes it is refused; the posture stays open.",
      ],
      [
        "Your choice is kept on the decision; the platform takes no other step on it.",
        "Your choice is kept on the decision; the platform takes no other step on it.",
      ],
      [
        "Your choice is kept on the decision; the platform takes no other step on it.",
        "Your choice is kept on the decision; the platform takes no other step on it.",
      ],
    ]);
  });

  it("names a stray push to another ref as moving nothing", () => {
    const elsewhere = DecisionSubject.cases.StrayPush.make({
      after: sha("b"),
      before: sha("a"),
      ref: RefNameText.make("refs/heads/release"),
    });

    expect(consequenceOf(elsewhere, "revert")).toBe(
      "Only main is reverted: release stays where it is."
    );
  });
});

const vellum = ProjectName.make("vellum");

/** The page the route renders from what `readToday` sent, as the browser decodes it. */
const pageFrom = (encoded: typeof TodayPageData.Encoded) => {
  const data = Schema.decodeSync(TodayPageData)(encoded);

  return markupOf(
    <TodayView now={data.now} onDecide={() => {}} read={data.read} />
  );
};

describe("Today, read on the server with the reader's session", () => {
  it.live(
    "renders a decider's Today from the fixtures: the budget sentence, the sections and what waits",
    () =>
      Effect.gen(function* () {
        const markup = pageFrom(yield* readToday({ project: vellum }));
        const text = textIn(markup);

        expect(text).toContain(
          "Decisions: 2 taken, 3 left today. Finishes are counted apart: none taken."
        );
        expect(sectionsOf(markup).slice(0, 3)).toStrictEqual([
          "Due today",
          "Within your budget",
          "Waits for tomorrow",
        ]);
        expect(text).toContain("3 more wait for tomorrow");
        expect(rowsOf(markup)).toHaveLength(3);

        for (const { body } of rowsOf(markup)) {
          expect(body).toContain("data-consequence=");
        }
      }).pipe(Effect.provide(fixturesClient("ines-v")), Effect.scoped),
    60_000
  );

  it.live(
    "signed out, sends what Today is, the way to sign in and the command",
    () =>
      Effect.gen(function* () {
        const markup = pageFrom(yield* readToday({}));

        expect(textIn(markup)).toContain("Today is a decider's page");
        expect(textIn(markup)).toContain(`${Brand.cli} today`);
        expect(markup).not.toContain("data-decision");
      }).pipe(Effect.provide(fixturesClient()), Effect.scoped),
    60_000
  );

  it("is kept by no cache: its response is private and never stored", () => {
    expect(Route.options.headers).toBe(todayHeaders);
    expect(todayHeaders()).toStrictEqual({
      "Cache-Control": "private, no-store",
    });
  });
});
