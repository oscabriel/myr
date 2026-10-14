import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import type { AnswerView } from "@repo/protocol/domain/answer";
import { ClaimView } from "@repo/protocol/domain/claim";
import { DecisionSubject, Today } from "@repo/protocol/domain/decision";
import { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RequestId,
} from "@repo/protocol/ids";
import { ClaimLapsed } from "@repo/protocol/refusal";
import { isRedirect } from "@tanstack/react-router";
import { DateTime, Effect, Schema } from "effect";

import { InboxView } from "../src/features/inbox/inbox-page.tsx";
import { movedToInbox } from "../src/features/inbox/moved.ts";
import {
  askKey,
  Decisions,
  InboxPageData,
  InboxRead,
  pairWork,
  readInbox,
  Takeable,
} from "../src/features/inbox/read.ts";
import { Route as HomeRoute } from "../src/routes/home.tsx";
import { inboxHeaders, Route } from "../src/routes/inbox.tsx";
import { fixturesClient } from "./dev-client.ts";
import { textIn } from "./markup.ts";
import { renderAt } from "./render.tsx";

const NOW = "2026-10-07T12:00:00.000Z";

const pageFrom = (encoded: typeof InboxPageData.Encoded) =>
  Effect.gen(function* () {
    const data = yield* Schema.decodeEffect(InboxPageData)(encoded);

    return yield* renderAt(
      "/inbox",
      <InboxView now={data.now} onDecide={() => {}} read={data.read} />
    );
  });

const pageOf = (read: Partial<typeof InboxRead.cases.Read.Type>) =>
  renderAt(
    "/inbox",
    <InboxView
      now={DateTime.makeUnsafe(NOW)}
      onDecide={() => {}}
      read={InboxRead.cases.Read.make({
        asks: Takeable.cases.Listed.make({ asks: [] }),
        decisions: Decisions.cases.NotDecider.make({}),
        handle: Handle.make("bram"),
        held: 0,
        running: 0,
        work: [],
        ...read,
      })}
    />
  );

const sectionsOf = (markup: string) =>
  [...markup.matchAll(/<section\b[^>]*aria-label="(?<name>[^"]+)"/gu)].map(
    (found) => found.groups?.name
  );

/** Each stage of a strip with its state, in the gate's order. */
const stagesOf = (markup: string) =>
  [
    ...markup.matchAll(
      /data-stage="(?<stage>[^"]+)" data-state="(?<state>[^"]+)"/gu
    ),
  ].map((found) => `${found.groups?.stage} ${found.groups?.state}`);

const commandsOf = (markup: string) =>
  [...markup.matchAll(/<code\b[^>]*>(?<command>.*?)<\/code>/gsu)].map((found) =>
    textIn(found.groups?.command ?? "").trim()
  );

const claim = (fields: Partial<typeof ClaimView.Encoded> = {}) =>
  Schema.decodeSync(ClaimView)({
    ask: "fix-week-start",
    base: "a".repeat(40),
    checkCommand: `${Brand.cli} check fix-week-start --project oscabriel/datekit`,
    claimant: "bram",
    fork: "datekit--fix-week-start--bram",
    lapsesAt: "2026-10-08T12:00:00.000Z",
    openedAt: "2026-10-07T09:00:00.000Z",
    project: "datekit",
    remote: "https://git.example/datekit--fix-week-start--bram",
    state: "live",
    warnsAt: "2026-10-08T06:00:00.000Z",
    ...fields,
  });

const refused = (ask: string): AnswerView => ({
  ask: AskId.make(ask),
  at: DateTime.makeUnsafe("2026-10-07T11:00:00Z"),
  head: CommitSha.make("b".repeat(40)),
  outcome: Outcome.cases.Refused.make({
    refusals: [ClaimLapsed.of(AskId.make(ask))],
  }),
  requestId: RequestId.make(`req-${ask}`),
});

const decision = (id: string, handle: string, expiresAt: string) => ({
  deciders: ["ines-v"] as const,
  default: "decline" as const,
  evidence: [],
  expiresAt,
  id,
  openedAt: "2026-10-06T09:00:00.000Z",
  project: "datekit",
  subject: DecisionSubject.cases.Vouch.make({ handle: Handle.make(handle) }),
});

const today = Schema.decodeSync(Today)({
  budget: { finishes: 0, total: 5, used: 1 },
  decider: "ines-v",
  decisions: [
    decision("dec-000002", "lin-h", "2026-10-09T12:00:00.000Z"),
    decision("dec-000001", "tamsin", "2026-10-08T12:00:00.000Z"),
  ],
  expiringSoon: [],
  newcomers: [],
  overflow: 0,
  unattended: [],
});

const takeable = Schema.decodeSync(FrontPageEntry)({
  ask: {
    ask: "split-format",
    blockedBy: [],
    claimed: false,
    kind: "migrate",
    territory: "format",
    want: "The format package calls the new parser.",
  },
  posture: "open",
  project: "burrow",
  takeable: true,
});

describe("the inbox, for the asks a reader holds and may take", () => {
  it.effect(
    "shows a running claim by its want, with its check command, and a refused answer with its next command",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageOf({
          held: 2,
          running: 2,
          work: [
            {
              claim: claim(),
              want: "A week starts on the locale's first day.",
            },
            {
              answer: refused("parse-iso-week"),
              claim: claim({
                ask: "parse-iso-week",
                fork: "datekit--parse-iso-week--bram",
              }),
              want: "Parse an ISO week date.",
            },
          ],
        });

        expect(textIn(markup)).toContain(
          "A week starts on the locale's first day."
        );
        expect(commandsOf(markup)).toStrictEqual(
          expect.arrayContaining([
            `${Brand.cli} check fix-week-start --project oscabriel/datekit`,
            `${Brand.cli} claim parse-iso-week`,
          ])
        );
        // A refusal a new push can mend turns back, in its own mark.
        expect(markup).toContain("lucide-rotate-ccw");
        expect(markup).toContain(
          'href="/oscabriel/datekit/answers/parse-iso-week"'
        );
      })
  );

  it.effect(
    "draws an answer's progress through the seven stages under its claim",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageOf({
          held: 1,
          running: 1,
          work: [
            {
              answer: refused("parse-iso-week"),
              claim: claim({
                ask: "parse-iso-week",
                fork: "datekit--parse-iso-week--bram",
              }),
              stage: "heldBack",
            },
          ],
        });

        const stages = [
          ...markup.matchAll(
            /data-stage="(?<stage>[^"]+)" data-state="(?<state>[^"]+)"/gu
          ),
        ].map((found) => `${found.groups?.stage} ${found.groups?.state}`);

        expect(stages).toStrictEqual([
          "parse passed",
          "shape passed",
          "merge passed",
          "cheap passed",
          "checks passed",
          "heldBack refused",
          "human pending",
        ]);
      })
  );

  it.effect(
    "reads a landed answer's held-back and maintainer stages as not needed when its verdict held neither, as the answer page does",
    () =>
      Effect.gen(function* () {
        const landed: AnswerView = {
          ...refused("parse-iso-week"),
          outcome: Outcome.cases.Landed.make({
            sha: LandedSha.make("c".repeat(40)),
          }),
        };

        const work = {
          answer: landed,
          claim: claim({
            ask: "parse-iso-week",
            fork: "datekit--parse-iso-week--bram",
            state: "answered",
          }),
          stage: "human",
        } as const;

        expect(
          stagesOf(
            yield* pageOf({
              work: [{ ...work, holds: { decided: false, heldBack: false } }],
            })
          ).slice(5)
        ).toStrictEqual(["heldBack skipped", "human skipped"]);
        expect(
          stagesOf(
            yield* pageOf({
              work: [{ ...work, holds: { decided: true, heldBack: true } }],
            })
          ).slice(5)
        ).toStrictEqual(["heldBack passed", "human passed"]);
      })
  );

  it.effect("draws no stages for a claim with no answer pushed yet", () =>
    Effect.gen(function* () {
      const markup = yield* pageOf({
        held: 1,
        running: 1,
        work: [{ claim: claim() }],
      });

      expect(markup).not.toContain("data-stage=");
    })
  );

  it.effect(
    "orders its blocks: the decisions waiting, your claims, then the asks to take",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageOf({
          asks: Takeable.cases.Listed.make({ asks: [takeable] }),
          decisions: Decisions.cases.Decides.make({ today }),
        });

        expect(sectionsOf(markup)).toStrictEqual([
          "Within your budget",
          "Your claims",
          "Asks you may take",
        ]);
        expect(markup).toMatch(
          /data-decision="dec-000001"[\s\S]*data-decision="dec-000002"/u
        );
        expect(markup).not.toContain('href="/today"');
        expect(markup).not.toContain('href="/home"');
      })
  );

  it.effect("leaves the decisions out for a reader who decides nowhere", () =>
    Effect.gen(function* () {
      const markup = yield* pageOf({});

      expect(sectionsOf(markup)).toStrictEqual([
        "Your claims",
        "Asks you may take",
      ]);
    })
  );

  it.effect(
    "says so, with a command, when the decisions or the asks did not come, rather than showing none",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageOf({
          asks: Takeable.cases.Unreachable.make({}),
          decisions: Decisions.cases.Unreachable.make({}),
        });

        const text = textIn(markup);

        expect(text).toContain("Your decisions did not come");
        expect(text).toContain("The asks did not come");
        expect(text).not.toContain("No open ask is yours to take");
        expect(commandsOf(markup)).toStrictEqual(
          expect.arrayContaining([`${Brand.cli} today`, `${Brand.cli} front`])
        );
      })
  );

  it.effect(
    "with no claim, gives the claim command for the first ask the reader may take",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageOf({
          asks: Takeable.cases.Listed.make({ asks: [takeable] }),
        });

        expect(textIn(markup)).toContain("You hold no claim.");
        expect(commandsOf(markup)).toContain(
          `${Brand.cli} claim split-format --project oscabriel/burrow`
        );
      })
  );

  it.effect("links the reader's handle and their record", () =>
    Effect.gen(function* () {
      const markup = yield* pageOf({});

      expect(textIn(markup)).toContain("Signed in as bram.");
      expect(markup).toContain('href="/people/bram"');
    })
  );

  it.effect(
    "past the claims it shows, says how many there are and gives the command for every one",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageOf({
          held: 14,
          running: 1,
          work: [{ claim: claim() }],
        });

        expect(textIn(markup)).toContain("The newest 10 of your 14 claims");
        expect(commandsOf(markup)).toContain(`${Brand.cli} status`);
      })
  );
});

describe(pairWork, () => {
  it("gives an answer to the newest claim on its ask, and an older claim its own state", () => {
    const older = claim({
      openedAt: "2026-10-01T09:00:00.000Z",
      state: "lapsed",
    });

    const newer = claim();
    const answer = refused("fix-week-start");

    const work = pairWork({
      again: new Map(),
      answers: [answer],
      claims: [older, newer],
      wants: new Map([
        [askKey(newer), "A week starts on the locale's first day."],
      ]),
    });

    expect(
      work.map(({ answer: paired, claim: held }) => [held.state, paired])
    ).toStrictEqual([
      ["live", answer],
      ["lapsed", undefined],
    ]);
    expect(work.map(({ want }) => want)).toStrictEqual([
      "A week starts on the locale's first day.",
      "A week starts on the locale's first day.",
    ]);
  });

  it("reads an ask held in two projects from each project's own answers", () => {
    const inDatekit = claim();

    const inBurrow = claim({
      fork: "burrow--fix-week-start--bram",
      project: "burrow",
    });

    const datekitAnswer = refused("fix-week-start");

    const work = pairWork({
      again: new Map([
        [ProjectName.make("oscabriel/datekit"), [datekitAnswer]],
        [ProjectName.make("oscabriel/burrow"), []],
      ]),
      // `status` across every project: which project this answer is in, it does not say.
      answers: [datekitAnswer],
      claims: [inDatekit, inBurrow],
      wants: new Map(),
    });

    expect(
      work.map(({ answer, claim: held }) => [held.project, answer])
    ).toStrictEqual([
      ["oscabriel/datekit", datekitAnswer],
      ["oscabriel/burrow", undefined],
    ]);
  });
});

describe("the inbox, read on the server with the reader's session", () => {
  it.live(
    "gives a contributor their claims by their wants, the asks they may take and their record, and no decisions",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageFrom(yield* readInbox({}));

        expect(sectionsOf(markup)).toStrictEqual([
          "Your claims",
          "Asks you may take",
        ]);
        expect(markup).toMatch(
          /data-claim="[^"]+"[^>]*data-project="oscabriel\/vellum"/u
        );
        expect(markup).toContain('href="/people/bram"');
        expect(markup).toContain('href="/asks"');
      }).pipe(Effect.provide(fixturesClient("bram")), Effect.scoped),
    60_000
  );

  it.live(
    "draws a contributor's answered claim with its stages, and no command while the gate still checks the latest push",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageFrom(yield* readInbox({}));

        expect(markup).toMatch(/<li[^>]*data-claim="[^"]+"/u);
        expect(markup).toContain('aria-label="Gate stages"');
        // Bram's parse-iso-week: refused once, the second push at the merge, so nothing for him to run yet.
        expect(markup).toContain("Checking");
        expect(markup).not.toMatch(/Copy (?:next|check) command/u);
      }).pipe(Effect.provide(fixturesClient("bram")), Effect.scoped),
    60_000
  );

  it.live(
    "gives a maintainer the decisions waiting for them, each linking its page",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageFrom(yield* readInbox({}));

        expect(sectionsOf(markup)).toStrictEqual(
          expect.arrayContaining(["Your claims", "Asks you may take"])
        );
        expect(markup).toMatch(/<li[^>]*data-decision="dec-[^"]+"/u);
        expect(markup).toMatch(/href="\/[a-z-]+\/[a-z-]+\/decisions\/[^"]+"/u);
      }).pipe(Effect.provide(fixturesClient("ines-v")), Effect.scoped),
    60_000
  );

  it.live(
    "signed out, says what the page is, how to sign in and come back, and the command",
    () =>
      Effect.gen(function* () {
        const markup = yield* pageFrom(yield* readInbox({}));

        expect(textIn(markup)).toContain(`${Brand.cli} status`);
        expect(markup).toContain(
          `href="/auth/signin?return=${encodeURIComponent("/inbox")}"`
        );
        expect(sectionsOf(markup)).toStrictEqual([]);
      }).pipe(Effect.provide(fixturesClient()), Effect.scoped),
    60_000
  );

  it("is a personal page, kept by no cache: its response is private and never stored", () => {
    expect(Route.options.headers).toBe(inboxHeaders);
    expect(inboxHeaders()).toStrictEqual({
      "Cache-Control": "private, no-store",
    });
  });

  it("is drawn in the project shell", () => {
    expect(Route.options.staticData?.shell).toBe("project");
  });
});

const movedFrom = (searchStr: string) =>
  Effect.tryPromise({
    catch: (thrown) =>
      isRedirect(thrown)
        ? [thrown.status, thrown.headers.get("location")]
        : ["not a redirect"],
    try: () => movedToInbox({ location: { searchStr } }),
  }).pipe(Effect.flip);

describe("/home, once the reader's own page", () => {
  // The worker answers a document load with its 301 (legacy-redirect.test.ts); a page kept before the move may still link here.
  it.effect("sends a navigation on to /inbox, the query kept", () =>
    Effect.gen(function* () {
      expect(HomeRoute.options.beforeLoad).toBe(movedToInbox);
      expect(yield* movedFrom("")).toStrictEqual([301, "/inbox"]);
      expect(yield* movedFrom("?decision=dec-000001")).toStrictEqual([
        301,
        "/inbox?decision=dec-000001",
      ]);
    })
  );
});
