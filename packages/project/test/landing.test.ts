import { describe, expect, it } from "@effect/vitest";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  BlobSha,
  CommitSha,
  DecisionId,
  Handle,
  LandedSha,
  ProjectName,
  RatchetName,
  RepoName,
  RepoPath,
  RequestId,
  TreeSha,
} from "@repo/protocol/ids";
import {
  ChecksFailed,
  PostureChange,
  StaleBase,
  Weakened,
} from "@repo/protocol/refusal";
import { DateTime, Duration, Option, Schema } from "effect";

import { ProjectEventInput } from "../src/events.ts";
import {
  backoff,
  enqueue,
  LandingCommand,
  LandingEffect,
  LandingQueue,
  LandingState,
  maxRemerges,
  next as admitNext,
  outcomeOf,
  pendingEffects,
  Request,
  settle,
  transition,
} from "../src/landing.ts";

const hex = (n: number) => n.toString(16).padStart(40, "0");

const now = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

const alice = Handle.make("alice");

const bob = Handle.make("bob");

const base = CommitSha.make(hex(0xba_5e));

const head = CommitSha.make(hex(0x4e_ad));

const main = LandedSha.make(hex(0xa1));

const movedMain = LandedSha.make(hex(0xa2));

const landed = LandedSha.make(hex(0xa3));

const tree = TreeSha.make(hex(0x7_e1));

const fork = RepoName.make("datekit--parse-dates--bob");

const ask = AskId.make("parse-dates");

const project = ProjectName.make("datekit");

const requestId = RequestId.make("push-4ead");

const changed = RepoPath.make("src/parse.ts");

const changes = [
  {
    after: BlobSha.make(hex(0xb2)),
    before: BlobSha.make(hex(0xb1)),
    path: changed,
    status: "modified" as const,
  },
];

const request = Request.make({
  answerer: bob,
  ask: Option.some(ask),
  assisted: [],
  base,
  credits: [
    { handle: alice, role: "Asked-by" },
    { handle: bob, role: "Signed-off-by" },
  ],
  fork,
  head,
  project,
  requestId,
});

const raise = DecisionSubject.cases.RaiseRatchet.make({
  after: 4,
  ask,
  before: 3,
  ratchet: RatchetName.make("escapes"),
  territory: "packages/parse",
});

const decisionId = DecisionId.make("dec-000001");

const {
  AwaitingDecision,
  AwaitingFinish,
  Checking,
  Landed,
  Landing,
  Merging,
  Queued,
  Refused,
  WaitingOnParent,
} = LandingState.cases;

const underway = { attempt: 0, main, remerges: 0, request };

const merging = Merging.make(underway);

const checking = Checking.make({ ...underway, changes, tree });

const landing = Landing.make({ ...underway, tree });

const clean = {
  decisions: [],
  finish: "never" as const,
  refusals: [],
  tree,
};

const failed = new ChecksFailed({
  lane: "unit",
  logRef: "datekit/push-4ead/unit#1",
  next: "bun test src/parse.test.ts",
});

const terminal = [
  Landed.make({ request, sha: landed }),
  Refused.make({ refusals: [failed], request }),
];

const everyCommand = [
  LandingCommand.Start({ main }),
  LandingCommand.Wait({ parent: ask }),
  LandingCommand.Merged({ changes, main, tree }),
  LandingCommand.MergeConflict({ conflicts: [changed], main }),
  LandingCommand.Checked(clean),
  LandingCommand.Finished({ by: alice }),
  LandingCommand.Decided({ by: alice, choice: "accept", decision: decisionId }),
  LandingCommand.MainMoved({ from: main, main: movedMain }),
  LandingCommand.LandedOk({ sha: landed }),
  LandingCommand.Busy({ attempt: 0 }),
  LandingCommand.Blocked({ attempt: 0 }),
];

describe("an answer on its way to main", () => {
  it("is merged onto the landed main when the queue starts it", () => {
    const step = transition(
      Queued.make({ request }),
      LandingCommand.Start({ main }),
      now
    );

    expect(step).toStrictEqual({
      effects: [LandingEffect.Merge({ base, fork, head, main })],
      state: merging,
    });
  });

  it("is checked on the exact tree a clean merge made", () => {
    const step = transition(
      merging,
      LandingCommand.Merged({ changes, main, tree }),
      now
    );

    expect(step).toStrictEqual({
      effects: [LandingEffect.RunChecks({ tree })],
      state: checking,
    });
  });

  it("is refused as stale when its merge onto main conflicts", () => {
    const step = transition(
      merging,
      LandingCommand.MergeConflict({ conflicts: [changed], main }),
      now
    );

    expect(step).toStrictEqual({
      effects: [],
      state: Refused.make({
        refusals: [new StaleBase({ base, conflicts: [changed], main })],
        request,
      }),
    });
  });

  it("lands the checked tree when its checks pass and nobody has to act", () => {
    const step = transition(checking, LandingCommand.Checked(clean), now);

    expect(step).toStrictEqual({
      effects: [LandingEffect.Land({ main, tree })],
      state: landing,
    });
  });

  it("is refused with every refusal its checks gave", () => {
    const step = transition(
      checking,
      LandingCommand.Checked({ ...clean, refusals: [failed] }),
      now
    );

    expect(step).toStrictEqual({
      effects: [],
      state: Refused.make({ refusals: [failed], request }),
    });
  });

  it("waits for a decider's finish when its kind requires one", () => {
    const step = transition(
      checking,
      LandingCommand.Checked({ ...clean, finish: "required" }),
      now
    );

    expect(step).toStrictEqual({
      effects: [],
      state: AwaitingFinish.make({ ...underway, tree }),
    });
  });

  it("waits on a decision when it raises a ratchet with a reason", () => {
    const step = transition(
      checking,
      LandingCommand.Checked({
        ...clean,
        decisions: [{ id: decisionId, subject: raise }],
      }),
      now
    );

    expect(step).toStrictEqual({
      effects: [],
      state: AwaitingDecision.make({
        ...underway,
        decisions: [{ id: decisionId, subject: raise }],
        finish: "never",
        tree,
      }),
    });
  });

  it("goes back to merge, against the new main, when main moved while landing", () => {
    const step = transition(
      landing,
      LandingCommand.MainMoved({ from: main, main: movedMain }),
      now
    );

    expect(step).toStrictEqual({
      effects: [LandingEffect.Merge({ base, fork, head, main: movedMain })],
      state: Merging.make({ ...underway, main: movedMain, remerges: 1 }),
    });
  });

  it(`is refused as stale when main moves after ${maxRemerges} re-merges`, () => {
    const step = transition(
      Landing.make({ ...underway, remerges: maxRemerges, tree }),
      LandingCommand.MainMoved({ from: main, main: movedMain }),
      now
    );

    expect(maxRemerges).toBe(3);
    expect(step).toStrictEqual({
      effects: [],
      state: Refused.make({
        refusals: [new StaleBase({ base, conflicts: [], main: movedMain })],
        request,
      }),
    });
  });

  it("is landed, announced and recorded when its landing is on main", () => {
    const step = transition(
      landing,
      LandingCommand.LandedOk({ sha: landed }),
      now
    );

    expect(step).toStrictEqual({
      effects: [
        LandingEffect.Emit({
          event: ProjectEventInput.Landed({
            at: now,
            landing: {
              ask,
              assisted: [],
              author: bob,
              credits: request.credits,
              landedAt: now,
              parent: main,
              project,
              requestId,
              sha: landed,
            },
          }),
        }),
        LandingEffect.Record({ sha: landed }),
      ],
      state: Landed.make({ request, sha: landed }),
    });
  });

  it("retries with backoff when the repo is busy", () => {
    const step = transition(landing, LandingCommand.Busy({ attempt: 0 }), now);

    expect(step).toStrictEqual({
      effects: [
        LandingEffect.Retry({
          at: DateTime.makeUnsafe("2026-10-07T12:00:01Z"),
        }),
      ],
      state: Landing.make({ ...underway, attempt: 1, tree }),
    });
  });

  it("never moves once landed or refused, whatever it hears", () => {
    for (const state of terminal) {
      for (const command of everyCommand) {
        expect(transition(state, command, now)).toStrictEqual({
          effects: [],
          state,
        });
      }
    }
  });
});

describe("a report about another main, tree, attempt or decision", () => {
  const otherMain = LandedSha.make(hex(0xa9));
  const otherTree = TreeSha.make(hex(0x7_e9));

  const replays = [
    [merging, LandingCommand.Merged({ changes, main: otherMain, tree })],
    [merging, LandingCommand.MergeConflict({ conflicts: [], main: otherMain })],
    [merging, LandingCommand.Blocked({ attempt: 1 })],
    [checking, LandingCommand.Checked({ ...clean, tree: otherTree })],
    [landing, LandingCommand.MainMoved({ from: otherMain, main: movedMain })],
    [landing, LandingCommand.MainMoved({ from: main, main })],
    [landing, LandingCommand.Busy({ attempt: 1 })],
    [checking, LandingCommand.LandedOk({ sha: landed })],
  ] as const;

  it("changes nothing, so a late or replayed report converges", () => {
    for (const [state, command] of replays) {
      expect(transition(state, command, now)).toStrictEqual({
        effects: [],
        state,
      });
    }
  });
});

describe("a port that cannot run", () => {
  it("is retried with a backoff that doubles, up to five minutes", () => {
    expect([0, 1, 2, 12].map(backoff)).toStrictEqual([
      Duration.seconds(1),
      Duration.seconds(2),
      Duration.seconds(4),
      Duration.minutes(5),
    ]);
  });

  it("leaves the answer where it was, never refused for it", () => {
    for (const state of [merging, checking, landing]) {
      const step = transition(
        state,
        LandingCommand.Blocked({ attempt: 0 }),
        now
      );

      expect(step).toStrictEqual({
        effects: [
          LandingEffect.Retry({ at: DateTime.addDuration(now, backoff(0)) }),
        ],
        state: { ...state, attempt: 1 },
      });
      expect(pendingEffects(step.state)).toStrictEqual(pendingEffects(state));
    }
  });
});

describe("a finish", () => {
  const waiting = AwaitingFinish.make({ ...underway, tree });

  const finished = Request.make({
    ...request,
    credits: [...request.credits, { handle: alice, role: "Finished-by" }],
  });

  it("lands the answer and credits the decider who gave it", () => {
    expect(
      transition(waiting, LandingCommand.Finished({ by: alice }), now)
    ).toStrictEqual({
      effects: [LandingEffect.Land({ main, tree })],
      state: Landing.make({ ...underway, request: finished, tree }),
    });
  });

  it("is not asked for again after a moved main sends the answer back through its checks", () => {
    const rechecked = Checking.make({
      ...underway,
      changes,
      request: finished,
      tree,
    });

    expect(
      transition(
        rechecked,
        LandingCommand.Checked({ ...clean, finish: "required" }),
        now
      ).state
    ).toStrictEqual(Landing.make({ ...underway, request: finished, tree }));
  });
});

describe("a decision the answer waits on", () => {
  const posture = DecisionSubject.cases.PostureChange.make({
    from: "open",
    to: "openCore",
  });

  const waiver = DecisionSubject.cases.Waiver.make({
    ask,
    at: { line: 12, path: changed },
    marker: ".skip(",
    reason: "flaky on CI until the clock fix lands",
  });

  const secondId = DecisionId.make("dec-000002");

  const waiting = (subject: typeof raise | typeof posture | typeof waiver) =>
    AwaitingDecision.make({
      ...underway,
      decisions: [{ id: decisionId, subject }],
      finish: "never",
      tree,
    });

  it("lands the answer once accepted, and credits the decider who accepted it", () => {
    expect(
      transition(
        waiting(raise),
        LandingCommand.Decided({
          by: alice,
          choice: "accept",
          decision: decisionId,
        }),
        now
      )
    ).toStrictEqual({
      effects: [LandingEffect.Land({ main, tree })],
      state: Landing.make({
        ...underway,
        request: Request.make({
          ...request,
          credits: [
            { handle: alice, role: "Asked-by" },
            { handle: bob, role: "Signed-off-by" },
            { handle: alice, role: "Decided-by" },
          ],
        }),
        tree,
      }),
    });
  });

  it("waits on the next decision, then on a required finish, crediting its decider once", () => {
    const both = AwaitingDecision.make({
      ...underway,
      decisions: [
        { id: decisionId, subject: raise },
        { id: secondId, subject: waiver },
      ],
      finish: "required",
      tree,
    });

    const decided = Request.make({
      ...request,
      credits: [...request.credits, { handle: alice, role: "Decided-by" }],
    });

    const first = transition(
      both,
      LandingCommand.Decided({
        by: alice,
        choice: "accept",
        decision: decisionId,
      }),
      now
    );

    expect(first.state).toStrictEqual(
      AwaitingDecision.make({
        ...underway,
        decisions: [{ id: secondId, subject: waiver }],
        finish: "required",
        request: decided,
        tree,
      })
    );
    expect(
      transition(
        first.state,
        LandingCommand.Decided({
          by: alice,
          choice: "accept",
          decision: secondId,
        }),
        now
      ).state
    ).toStrictEqual(
      AwaitingFinish.make({ ...underway, request: decided, tree })
    );
  });

  it("refuses the answer with the refusal it stands for when declined", () => {
    const cases = [
      [
        raise,
        new Weakened({
          weakening: {
            after: 4,
            before: 3,
            ratchet: "escapes",
            territory: "packages/parse",
          },
        }),
      ],
      [
        waiver,
        new Weakened({
          at: { line: 12, path: changed },
          weakening: {
            marker: ".skip(",
            reason: "flaky on CI until the clock fix lands",
          },
        }),
      ],
      [posture, new PostureChange({ from: "open", to: "openCore" })],
    ] as const;

    for (const [subject, refusal] of cases) {
      expect(
        transition(
          waiting(subject),
          LandingCommand.Decided({
            by: alice,
            choice: "decline",
            decision: decisionId,
          }),
          now
        )
      ).toStrictEqual({
        effects: [],
        state: Refused.make({ refusals: [refusal], request }),
      });
    }
  });

  it("ignores a choice on a decision it does not wait on", () => {
    const state = waiting(raise);

    expect(
      transition(
        state,
        LandingCommand.Decided({
          by: alice,
          choice: "decline",
          decision: secondId,
        }),
        now
      )
    ).toStrictEqual({ effects: [], state });
  });
});

describe("an answer to a blocked ask", () => {
  it("waits on its parent, then merges when the queue starts it", () => {
    const parent = AskId.make("move-to-temporal");

    const waits = transition(
      Queued.make({ request }),
      LandingCommand.Wait({ parent }),
      now
    );

    expect(waits).toStrictEqual({
      effects: [],
      state: WaitingOnParent.make({ parent, request }),
    });
    expect(
      transition(waits.state, LandingCommand.Start({ main }), now)
    ).toStrictEqual({
      effects: [LandingEffect.Merge({ base, fork, head, main })],
      state: merging,
    });
  });
});

describe("the outcome a person reads", () => {
  it("names the stage while checking, and the wait or the result after", () => {
    expect(
      [
        Queued.make({ request }),
        merging,
        checking,
        landing,
        AwaitingFinish.make({ ...underway, tree }),
        AwaitingDecision.make({
          ...underway,
          decisions: [{ id: decisionId, subject: raise }],
          finish: "never",
          tree,
        }),
        WaitingOnParent.make({ parent: ask, request }),
        Landed.make({ request, sha: landed }),
        Refused.make({ refusals: [failed], request }),
      ].map(outcomeOf)
    ).toStrictEqual([
      Outcome.cases.Checking.make({ stage: "merge" }),
      Outcome.cases.Checking.make({ stage: "merge" }),
      Outcome.cases.Checking.make({ stage: "checks" }),
      Outcome.cases.Checking.make({ stage: "human" }),
      Outcome.cases.AwaitingFinish.make({}),
      Outcome.cases.AwaitingDecision.make({ decision: decisionId }),
      Outcome.cases.WaitingOnParent.make({ ask }),
      Outcome.cases.Landed.make({ sha: landed }),
      Outcome.cases.Refused.make({ refusals: [failed] }),
    ]);
  });
});

describe("a landing the store keeps", () => {
  const states = [
    Queued.make({ request }),
    WaitingOnParent.make({ parent: ask, request }),
    merging,
    checking,
    AwaitingDecision.make({
      ...underway,
      decisions: [{ id: decisionId, subject: raise }],
      finish: "required",
      tree,
    }),
    AwaitingFinish.make({ ...underway, tree }),
    landing,
    // A decider's own landing answers no ask.
    Landed.make({
      request: Request.make({ ...request, ask: Option.none() }),
      sha: landed,
    }),
    Refused.make({ refusals: [failed], request }),
  ];

  it("comes back from its stored JSON as it was, in every state", () => {
    const Stored = Schema.fromJsonString(LandingState);

    expect(
      states.map((state) =>
        Schema.decodeSync(Stored)(Schema.encodeSync(Stored)(state))
      )
    ).toStrictEqual(states);
  });

  it("names, after a hydrate, the port call it waits on", () => {
    expect(states.map(pendingEffects)).toStrictEqual([
      [],
      [],
      [LandingEffect.Merge({ base, fork, head, main })],
      [LandingEffect.RunChecks({ tree })],
      [],
      [],
      [LandingEffect.Land({ main, tree })],
      [],
      [],
    ]);
  });

  it("keeps its queue as JSON too", () => {
    const Stored = Schema.fromJsonString(LandingQueue);

    const queues = [
      LandingQueue.make({ active: Option.none(), order: [] }),
      LandingQueue.make({
        active: Option.some(requestId),
        order: [RequestId.make("push-0002")],
      }),
    ];

    expect(
      queues.map((queue) =>
        Schema.decodeSync(Stored)(Schema.encodeSync(Stored)(queue))
      )
    ).toStrictEqual(queues);
  });
});

describe("the landing queue", () => {
  const first = RequestId.make("push-0001");
  const second = RequestId.make("push-0002");
  const empty = LandingQueue.make({ active: Option.none(), order: [] });

  it("takes a request once, however often it is enqueued", () => {
    const queue = enqueue(enqueue(enqueue(empty, first), second), first);

    expect(queue).toStrictEqual(
      LandingQueue.make({ active: Option.none(), order: [first, second] })
    );
    expect(enqueue(admitNext(queue).queue, first)).toStrictEqual(
      admitNext(queue).queue
    );
  });

  it("admits one request at a time, in the order they came", () => {
    const queue = enqueue(enqueue(empty, first), second);
    const admitted = admitNext(queue);

    expect(admitted).toStrictEqual({
      admit: Option.some(first),
      queue: LandingQueue.make({ active: Option.some(first), order: [second] }),
    });
    expect(admitNext(admitted.queue)).toStrictEqual({
      admit: Option.none(),
      queue: admitted.queue,
    });
    expect(admitNext(settle(admitted.queue, first)).admit).toStrictEqual(
      Option.some(second)
    );
  });

  it("admits nothing when nothing waits", () => {
    expect(admitNext(empty)).toStrictEqual({
      admit: Option.none(),
      queue: empty,
    });
  });

  it("drops a request settled before its turn", () => {
    const queue = settle(enqueue(enqueue(empty, first), second), second);

    expect(queue).toStrictEqual(
      LandingQueue.make({ active: Option.none(), order: [first] })
    );
  });
});
