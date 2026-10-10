/**
 * One fold over a project's `watch` replay, which every page reads the same
 * way: who holds each ask, its rounds and latest outcome, whether it landed;
 * whose move an outcome leaves; a family's marks counted against the
 * parent's stored children; and which landings a page that is open should
 * stamp, on the stream and on the poll alike. Events are built with their
 * cases, never a literal tag.
 */
import { describe, expect, it } from "@effect/vitest";
import type { Ask } from "@repo/protocol/domain/ask";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  CommitSha,
  DecisionId,
  Handle,
  LandedSha,
} from "@repo/protocol/ids";
import { NoAsk } from "@repo/protocol/refusal";
import { DateTime, Schema } from "effect";

import {
  askStates,
  familyMarks,
  lastSeq,
  recentLandings,
  stampsFrom,
  whoseMove,
} from "../src/client/events.ts";
import type { Mark, Move } from "../src/client/events.ts";
import { ask as fixture } from "./ask-fixtures.ts";

const at = DateTime.toUtc(DateTime.makeUnsafe("2026-10-07T12:00:00Z"));

const later = DateTime.toUtc(DateTime.makeUnsafe("2026-10-07T12:05:00Z"));

const ask = AskId.make("parse-iso-week");

const alice = Handle.make("alice");

const bram = Handle.make("bram");

const first = CommitSha.make("a".repeat(40));

const second = CommitSha.make("b".repeat(40));

const landedSha = LandedSha.make("c".repeat(40));

const refused = Outcome.cases.Refused.make({ refusals: [new NoAsk({})] });

const checking = Outcome.cases.Checking.make({ stage: "checks" });

const claimed = (seq: number, claimant = alice, on = ask) =>
  ProjectEvent.cases.Claimed.make({ ask: on, at, claimant, seq });

const judged = (
  seq: number,
  outcome: Outcome,
  head = first,
  on = ask,
  when = at
) => ProjectEvent.cases.Judged.make({ ask: on, at: when, head, outcome, seq });

const closed = (seq: number, on = ask) =>
  ProjectEvent.cases.AskClosed.make({ ask: on, at, landing: landedSha, seq });

describe(askStates, () => {
  it("leaves no claimant once a claim is released", () => {
    const states = askStates([
      claimed(1),
      ProjectEvent.cases.Released.make({ ask, at, seq: 2 }),
    ]);

    expect(states.get(ask)?.claimant).toBeUndefined();
    expect(states.get(ask)?.lastSeq).toBe(2);
  });

  it("leaves no claimant once a claim lapses", () => {
    const states = askStates([
      claimed(1),
      ProjectEvent.cases.Lapsed.make({ ask, at, seq: 2 }),
    ]);

    expect(states.get(ask)?.claimant).toBeUndefined();
  });

  it("names the last claimant", () => {
    const states = askStates([
      claimed(1),
      ProjectEvent.cases.Released.make({ ask, at, seq: 2 }),
      claimed(3, bram),
    ]);

    expect(states.get(ask)?.claimant).toBe(bram);
  });

  it("keeps each round in order, the latest outcome the second's", () => {
    const states = askStates([
      claimed(1),
      ProjectEvent.cases.Pushed.make({ ask, at, head: first, seq: 2 }),
      judged(3, refused),
      ProjectEvent.cases.Pushed.make({ ask, at: later, head: second, seq: 4 }),
      judged(5, checking, second, ask, later),
    ]);

    expect(states.get(ask)).toStrictEqual({
      claimant: alice,
      lastPush: { at: later, head: second },
      lastSeq: 5,
      latest: checking,
      rounds: [
        { at, head: first, outcome: refused, seq: 3 },
        { at: later, head: second, outcome: checking, seq: 5 },
      ],
    });
  });

  it("marks an ask landed when it closes, and clears its claimant", () => {
    const states = askStates([
      claimed(1),
      judged(2, Outcome.cases.Landed.make({ sha: landedSha })),
      closed(3),
    ]);

    expect(states.get(ask)?.landed).toStrictEqual({ seq: 3, sha: landedSha });
    expect(states.get(ask)?.claimant).toBeUndefined();
  });

  it("gives the same map when an event is heard twice, or out of order", () => {
    const once = askStates([
      claimed(1),
      judged(2, refused),
      judged(3, checking),
    ]);

    expect(
      askStates([
        claimed(1),
        judged(2, refused),
        judged(3, checking),
        judged(2, refused),
      ])
    ).toStrictEqual(once);
    expect(
      askStates([
        judged(3, checking),
        claimed(1),
        judged(2, refused),
        claimed(1),
      ])
    ).toStrictEqual(once);
  });

  it("knows an ask from its opening on", () => {
    const states = askStates([
      ProjectEvent.cases.AskOpened.make({
        ask: {
          ask,
          blockedBy: [],
          claimed: false,
          kind: fixture.kind,
          territory: "parse",
          want: "Parse ISO week dates",
        },
        at,
        seq: 4,
      }),
    ]);

    expect(states.get(ask)).toStrictEqual({ lastSeq: 4, rounds: [] });
  });
});

describe(whoseMove, () => {
  it("names whose move each outcome leaves", () => {
    const each = {
      AwaitingDecision: Outcome.cases.AwaitingDecision.make({
        decision: DecisionId.make("dec-000001"),
      }),
      AwaitingFinish: Outcome.cases.AwaitingFinish.make({}),
      Checking: checking,
      Landed: Outcome.cases.Landed.make({ sha: landedSha }),
      Refused: refused,
      WaitingOnParent: Outcome.cases.WaitingOnParent.make({
        ask: AskId.make("drop-legacy-fetch"),
      }),
    } satisfies Record<Outcome["_tag"], Outcome>;

    expect(
      Object.fromEntries(
        Object.entries(each).map(([tag, outcome]) => [tag, whoseMove(outcome)])
      )
    ).toStrictEqual({
      AwaitingDecision: "decider",
      AwaitingFinish: "decider",
      Checking: "platform",
      Landed: "none",
      Refused: "answerer",
      WaitingOnParent: "family",
    } satisfies Record<Outcome["_tag"], Move>);
  });

  it("leaves a claimed ask with nothing judged to its answerer, and an open one to nobody", () => {
    expect({
      claimed: whoseMove(undefined, alice),
      open: whoseMove(),
    }).toStrictEqual({ claimed: "answerer", open: "none" });
  });
});

/** A child of `drop-legacy-fetch`, one per module. */
const child = (module: string) => AskId.make(`drop-legacy-fetch-${module}`);

describe(familyMarks, () => {
  const modules = [
    "auth",
    "billing",
    "catalog",
    "kit",
    "notify",
    "search",
  ] as const;

  const parent: Ask = {
    ...fixture,
    blockedBy: modules.map(child),
    id: AskId.make("drop-legacy-fetch"),
  };

  it("marks each stored child and counts the landed against all of them", () => {
    const events = [
      closed(1, child("auth")),
      closed(2, child("billing")),
      claimed(3, alice, child("catalog")),
      judged(4, checking, first, child("catalog")),
      claimed(5, bram, child("kit")),
      judged(6, refused, first, child("kit")),
      claimed(7, alice, child("notify")),
      judged(
        8,
        Outcome.cases.WaitingOnParent.make({ ask: parent.id }),
        first,
        child("notify")
      ),
      claimed(9, bram, child("search")),
    ];

    // A listing would name only the four still open as the parent's blockers.
    expect(familyMarks(parent, askStates(events))).toStrictEqual({
      children: [
        { ask: child("auth"), mark: "landed" },
        { ask: child("billing"), mark: "landed" },
        { ask: child("catalog"), mark: "checking" },
        { ask: child("kit"), mark: "refused" },
        { ask: child("notify"), mark: "waiting" },
        { ask: child("search"), mark: "claimed" },
      ] satisfies { ask: AskId; mark: Mark }[],
      landed: 2,
      total: 6,
    });
  });

  it("marks a child nothing has happened to open", () => {
    expect(familyMarks(parent, new Map()).children.at(0)).toStrictEqual({
      ask: child("auth"),
      mark: "open",
    });
  });

  it("marks a child whose refused claim was released open again", () => {
    const events = [
      claimed(1, alice, child("kit")),
      judged(2, refused, first, child("kit")),
      ProjectEvent.cases.Released.make({ ask: child("kit"), at, seq: 3 }),
    ];

    expect(familyMarks(parent, askStates(events)).children.at(3)).toStrictEqual(
      { ask: child("kit"), mark: "open" }
    );
  });
});

describe(stampsFrom, () => {
  it("stamps nothing a replay already held", () => {
    const states = askStates([claimed(1), closed(2)]);

    expect([...stampsFrom(undefined, states, 2)]).toStrictEqual([]);
    expect([...stampsFrom(states, states, 2)]).toStrictEqual([]);
  });

  it("stamps a landing the stream brought after the first read, once", () => {
    const mounted = askStates([claimed(1)]);
    const next = askStates([claimed(1), closed(2)]);

    const after = askStates([
      claimed(1),
      closed(2),
      claimed(3, bram, AskId.make("format-ordinal")),
    ]);

    expect([...stampsFrom(mounted, next, 1)]).toStrictEqual([ask]);
    expect([...stampsFrom(next, after, 1)]).toStrictEqual([]);
  });

  it("on the poll, stamps an ask landed since the previous read, and nothing the read after", () => {
    const before = askStates([claimed(5)]);
    const landed = askStates([claimed(5), closed(6)]);

    expect({
      first: [...stampsFrom(undefined, before, lastSeq([claimed(5)]))],
      next: [...stampsFrom(before, landed, 5)],
      readAfter: [...stampsFrom(landed, landed, 5)],
    }).toStrictEqual({ first: [], next: [ask], readAfter: [] });
  });
});

describe(lastSeq, () => {
  it("is the highest number among the events, 0 for none", () => {
    expect({
      none: lastSeq([]),
      some: lastSeq([claimed(3), claimed(9), claimed(4)]),
    }).toStrictEqual({ none: 0, some: 9 });
  });
});

/** The 40-hex sha of the `n`th landing. */
const shaOf = (n: number) => LandedSha.make(n.toString(16).padStart(40, "0"));

describe(recentLandings, () => {
  const one = Schema.decodeSync(LandingView)({
    assisted: [],
    author: "bram",
    credits: [{ handle: "bram", role: "Signed-off-by" }],
    landedAt: "2026-10-07T12:00:00.000Z",
    project: "datekit",
    sha: "0000000000000000000000000000000000000000",
  });

  const landed = (seq: number) =>
    ProjectEvent.cases.Landed.make({
      at,
      landing: { ...one, sha: shaOf(seq) },
      seq,
    });

  it("keeps only the landings among a project's events, newest first", () => {
    const events = [
      landed(1),
      ProjectEvent.cases.Claimed.make({
        ask: AskId.make("fix-week-start"),
        at,
        claimant: Handle.make("bram"),
        seq: 2,
      }),
      landed(3),
    ];

    expect(recentLandings(events).map(({ sha }) => sha)).toStrictEqual([
      shaOf(3),
      shaOf(1),
    ]);
  });

  it("keeps at most the twenty newest", () => {
    const events = Array.from({ length: 25 }, (_, index) => landed(index + 1));

    const shown = recentLandings(events).map(({ sha }) => sha);

    expect(shown).toHaveLength(20);
    expect(shown.at(0)).toBe(shaOf(25));
    expect(shown.at(-1)).toBe(shaOf(6));
  });
});
