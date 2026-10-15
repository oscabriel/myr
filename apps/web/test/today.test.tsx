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
  RatchetName,
  RepoPath,
} from "@repo/protocol/ids";
import { DecisionClosed, UnknownProject } from "@repo/protocol/refusal";
import { isRedirect } from "@tanstack/react-router";
import { Cause, DateTime, Effect, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  allowedChoices,
  consequenceOf,
  describeSubject,
} from "../src/features/decision/decision-card.tsx";
import { orderDecisions } from "../src/features/inbox/decisions.ts";
import {
  waitingSentence,
  InboxView,
} from "../src/features/inbox/inbox-page.tsx";
import { movedToInbox } from "../src/features/inbox/moved.ts";
import {
  Decisions,
  InboxPageData,
  InboxRead,
  readInbox,
  Takeable,
} from "../src/features/inbox/read.ts";
import { RefusalView } from "../src/features/shared/refusal.tsx";
import { Route as TodayRoute } from "../src/routes/today.tsx";
import { fixturesClient } from "./dev-client.ts";

const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["&#x27;", "'"],
  ["&amp;", "&"],
  ["&gt;", ">"],
  ["&lt;", "<"],
  ["&quot;", '"'],
]);

const markupOf = (element: ReactElement) => renderToStaticMarkup(element);

const textIn = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(
      /&(?:#x27|amp|gt|lt|quot);/gu,
      (entity) => ENTITIES.get(entity) ?? entity
    )
    .replaceAll(/\s+/gu, " ");

const textOf = (element: ReactElement) => textIn(markupOf(element));

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

const choicesOf = (markup: string) =>
  rowsOf(markup).map(
    ({ body, id }) =>
      `${id}: ${[...body.matchAll(/data-choice="(?<choice>[^"]+)"/gu)]
        .map((each) => each.groups?.choice)
        .join(" ")}`
  );

const sectionsOf = (markup: string) => {
  const main = markup.includes("<aside")
    ? markup.slice(0, markup.indexOf("<aside"))
    : markup;

  return [...main.matchAll(/<h2[^>]*>(?<name>.*?)<\/h2>/gu)].map((match) =>
    textIn(match.groups?.name ?? "").trim()
  );
};

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const at = (iso: string) => DateTime.makeUnsafe(iso);

const sha = (digit: string) => CommitSha.make(digit.repeat(40));

const okonkwo = Handle.make("okonkwo");

const datekit = ProjectName.make("oscabriel/datekit");

const burrow = ProjectName.make("oscabriel/burrow");

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

const posture: Decision = {
  deciders: [okonkwo],
  default: "decline",
  evidence: [{ label: "why", value: "The tokenizer's fixtures stay private." }],
  expiresAt: at("2026-10-10T09:00:00Z"),
  id: DecisionId.make("dec-000001"),
  openedAt: at("2026-10-05T09:00:00Z"),
  project: burrow,
  subject: DecisionSubject.cases.PostureChange.make({
    from: "open",
    to: "openCore",
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
  decider: okonkwo,
  // Out of order on purpose: the page orders them.
  decisions: [posture, vouch, stray],
  expiringSoon: [stray.id],
  newcomers: [Handle.make("lin-h")],
  unattended: [
    landing("c", "format-date", "2026-10-07T09:00:00Z"),
    landing("d", "parse-iso", "2026-10-06T18:00:00Z"),
  ],
};

const deciding = (read: Today) =>
  InboxRead.cases.Read.make({
    asks: Takeable.cases.Listed.make({ asks: [] }),
    decisions: Decisions.cases.Decides.make({ today: read }),
    handle: okonkwo,
    held: 0,
    running: 0,
    work: [],
  });

const viewOf = (
  read: InboxRead,
  extra: Partial<Parameters<typeof InboxView>[0]> = {}
) => <InboxView now={now} onDecide={() => {}} read={read} {...extra} />;

const page = viewOf(deciding(today));

describe("the inbox, for the decisions waiting on a reader", () => {
  it("says how many decisions wait as one sentence, with how many are due today, and names no budget", () => {
    const text = textOf(page);

    expect(text).toContain(
      "Decisions: 3 waiting, 1 due today. Each takes its default if nobody decides before it expires."
    );
    expect(markupOf(page)).toContain('data-waiting="3"');
    expect(text).not.toContain("budget");
    expect(text).not.toContain("tomorrow");
  });

  it("says none when nothing waits, and leaves the due count out when none is due", () => {
    expect(waitingSentence({ ...today, decisions: [], expiringSoon: [] })).toBe(
      "Decisions: none waiting. Each takes its default if nobody decides before it expires."
    );
    expect(waitingSentence({ ...today, expiringSoon: [] })).toBe(
      "Decisions: 3 waiting. Each takes its default if nobody decides before it expires."
    );
  });

  it("puts its sections in order, each under its header: decisions, claims, asks, then what happened lately", () => {
    expect(sectionsOf(markupOf(page))).toStrictEqual([
      "Due today",
      "Later",
      "Your claims",
      "Asks you may take",
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
        "oscabriel/datekit/dec-000002",
        "main moved without a landing, from aaaaaaa to bbbbbbb",
      ],
      [
        "oscabriel/datekit/dec-000003",
        "Vouch for lin-h, so they may claim asks",
      ],
      [
        "oscabriel/burrow/dec-000001",
        "Change the project's posture from open to openCore",
      ],
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

    const text = textOf(viewOf(deciding({ ...today, decisions: [adopting] })));

    expect(text).toContain("If nobody decides by Thu 8 Oct, 10:00 UTC: adopt");
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
      "The answer that changes it goes on through the gate, with you as Decided-by."
    );
    expect(textOf(page)).toContain(
      "The answer that changes it is refused; the posture stays open."
    );
  });

  it("keeps a decision taken in its row, reading what it did, and offers its choices no more", () => {
    const taken: Decision = {
      ...posture,
      decided: { at: now, by: okonkwo, choice: "accept" },
    };

    const markup = markupOf(
      viewOf(
        deciding({
          ...today,
          decisions: [vouch, stray],
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
      "The answer that changes it goes on through the gate, with you as Decided-by."
    );
    expect(last?.body).not.toContain("data-choice=");
    expect(textIn(markup)).toContain("Decisions: 2 waiting, 1 due today.");
  });

  it("leaves the decisions and their count out for a reader who decides nowhere", () => {
    const markup = markupOf(
      viewOf({
        ...deciding(today),
        decisions: Decisions.cases.NotDecider.make({}),
      })
    );

    expect(markup).not.toContain("data-decision");
    expect(markup).not.toContain("data-waiting");
  });

  it("shows a refused read as the refusal, says what the inbox is, and lists no decision", () => {
    const refused = new UnknownProject({
      project: ProjectName.make("oscabriel/nope"),
    });

    const markup = markupOf(
      viewOf(InboxRead.cases.Refused.make({ refusal: refused }))
    );

    expect(markup).toContain(markupOf(<RefusalView refusals={[refused]} />));
    expect(markup).not.toContain("data-decision");
    expect(textIn(markup)).not.toContain(`${Brand.cli} status`);
  });

  it("signed out, says what the inbox is in one sentence and links to sign in, with no command", () => {
    const markup = markupOf(viewOf(InboxRead.cases.SignedOut.make({})));
    const text = textIn(markup);

    expect(text).toContain("The inbox is your own page");
    expect(markup).toMatch(
      /<a[^>]*href="\/auth\/signin[^"]*"[^>]*>Sign in<\/a>/u
    );
    expect(text).not.toContain(Brand.cli);
    expect(markup).not.toContain("data-decision");
  });

  it("shows a DecisionClosed refusal the maintainer's choice came back with", () => {
    const closed = new DecisionClosed({ decision: stray.id });

    const markup = markupOf(
      viewOf(deciding(today), {
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
      decisions: [posture, other, vouch, stray],
      expiringSoon: [stray.id],
    };

    expect(
      orderDecisions(merged).map(({ id, project }) => `${project}/${id}`)
    ).toStrictEqual([
      "oscabriel/datekit/dec-000002",
      "oscabriel/datekit/dec-000003",
      "oscabriel/burrow/dec-000001",
      "oscabriel/burrow/dec-000002",
    ]);
  });
});

const ask = AskId.make("parse-iso");

const subjects = [
  stray.subject,
  vouch.subject,
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

const vellum = ProjectName.make("oscabriel/vellum");

const pageFrom = (encoded: typeof InboxPageData.Encoded) => {
  const data = Schema.decodeSync(InboxPageData)(encoded);

  return markupOf(
    <InboxView now={data.now} onDecide={() => {}} read={data.read} />
  );
};

describe("the inbox's decisions, read on the server with the reader's session", () => {
  it.live(
    "renders a maintainer's decisions from the fixtures: the waiting sentence, every one in its section",
    () =>
      Effect.gen(function* () {
        const markup = pageFrom(yield* readInbox({ project: vellum }));
        const text = textIn(markup);

        expect(text).toContain("Decisions: 4 waiting, 1 due today.");
        expect(sectionsOf(markup).slice(0, 2)).toStrictEqual([
          "Due today",
          "Later",
        ]);
        expect(rowsOf(markup)).toHaveLength(4);

        for (const { body } of rowsOf(markup)) {
          expect(body).toContain("data-consequence=");
        }
      }).pipe(Effect.provide(fixturesClient("ines-v")), Effect.scoped),
    60_000
  );

  it.live(
    "refuses a project the platform does not know, with the refusal and no decision",
    () =>
      Effect.gen(function* () {
        const markup = pageFrom(
          yield* readInbox({ project: ProjectName.make("oscabriel/nope") })
        );

        expect(markup).toContain('data-refusal="UnknownProject"');
        expect(markup).not.toContain("data-decision");
      }).pipe(Effect.provide(fixturesClient("ines-v")), Effect.scoped),
    60_000
  );
});

const movedFrom = (searchStr: string) =>
  Effect.tryPromise({
    catch: (thrown) =>
      isRedirect(thrown)
        ? [thrown.status, thrown.headers.get("location")]
        : ["not a redirect"],
    try: () => movedToInbox({ location: { searchStr } }),
  }).pipe(Effect.flip);

describe("/today, once the maintainer's page", () => {
  // The worker answers a document load with its 301 (legacy-redirect.test.ts); a page kept before the move may still link here.
  it.effect(
    "sends a navigation on to /inbox, its project and decision kept",
    () =>
      Effect.gen(function* () {
        expect(TodayRoute.options.beforeLoad).toBe(movedToInbox);
        expect(
          yield* movedFrom("?project=oscabriel/datekit&decision=dec-000001")
        ).toStrictEqual([
          301,
          "/inbox?project=oscabriel/datekit&decision=dec-000001",
        ]);
      })
  );
});
