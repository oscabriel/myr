import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import {
  Evidence,
  Glob,
  Hostname,
  RefNameText,
} from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision } from "@repo/protocol/domain/decision";
import {
  AskId,
  EnvKey,
  Handle,
  RatchetName,
  RepoPath,
} from "@repo/protocol/ids";
import {
  DecisionClosed,
  NotDecider,
  UnknownDecision,
} from "@repo/protocol/refusal";
import { at } from "@repo/testkit/clock";
import { aProject, ids, sha } from "@repo/testkit/scenarios";
import { DateTime, Option, Result } from "effect";

import {
  decide,
  decidersFor,
  defaultChoice,
  expireDecisions,
  openDecision,
} from "../../src/attention/decisions.ts";
import {
  AttentionEffect,
  platformHandle,
} from "../../src/attention/effects.ts";
import { ProjectEventInput } from "../../src/events.ts";

const scenario = aProject({ deciders: ["alice", "dana"], people: ["bob"] });

const alice = Handle.make("alice");

const dana = Handle.make("dana");

const bob = Handle.make("bob");

const opened = at("2026-10-07T12:00:00Z");

const ask = AskId.make("parse-iso");

const before = sha("main before the stray push");

const after = sha("the stray push");

const main = RefNameText.make("refs/heads/main");

const minted = ids();

const proposal = minted.proposal();

const { OpenProposal, StrayPush } = DecisionSubject.cases;

/** Every subject, with the default it must have: doing nothing lets nothing in. */
const defaults: readonly (readonly [DecisionSubject, Choice])[] = [
  [OpenProposal.make({ proposal }), "decline"],
  [DecisionSubject.cases.Finish.make({ ask, head: sha("answer") }), "decline"],
  [
    DecisionSubject.cases.RaiseRatchet.make({
      after: 12,
      ask,
      before: 9,
      ratchet: RatchetName.make("lint"),
      territory: "parser",
    }),
    "decline",
  ],
  [StrayPush.make({ after, before, ref: main }), "revert"],
  [
    DecisionSubject.cases.PostureChange.make({
      from: "open",
      to: "openCore",
    }),
    "decline",
  ],
  [DecisionSubject.cases.Vouch.make({ handle: bob }), "decline"],
  [
    DecisionSubject.cases.SecretInTree.make({
      ask,
      item: EnvKey.make("STRIPE_KEY"),
    }),
    "decline",
  ],
  [
    DecisionSubject.cases.ProxyWidened.make({
      hosts: [Hostname.make("api.stripe.com")],
      item: EnvKey.make("STRIPE_KEY"),
    }),
    "decline",
  ],
  [
    DecisionSubject.cases.Waiver.make({
      ask,
      at: { line: 4, path: RepoPath.make("packages/parser/test/iso.test.ts") },
      marker: ".skip(",
      reason: "flaky on leap days until the clock fix lands",
    }),
    "decline",
  ],
];

const evidence = [
  Evidence.make({ label: "check", value: "packages/parser/test/iso.test.ts" }),
];

/** A decision for alice and dana, opened at noon with a 14-day expiry. */
const open = (subject: DecisionSubject) =>
  openDecision({
    deciders: [alice, dana],
    evidence,
    expireDays: 14,
    id: minted.decision(),
    now: opened,
    project: scenario.project,
    subject,
  });

const proposalDecision = open(OpenProposal.make({ proposal }));

const strayPush = open(StrayPush.make({ after, before, ref: main }));

const later = at("2026-10-08T09:30:00Z");

/** Alice's choice on `decision`, made the next morning. */
const choose = (decision: Decision, choice: Choice, by = alice) =>
  decide([decision], {
    by,
    choice,
    id: decision.id,
    note: Option.none(),
    now: later,
  });

/** The word `decision` records when alice chooses `choice`. */
const words = (decision: Decision, choice: Choice) =>
  Result.map(
    choose(decision, choice),
    ({ decision: { decided } }) => decided?.choice
  );

describe("opening a decision", () => {
  it.each(defaults)("gives %o the safe default %s", (subject, choice) => {
    expect(defaultChoice(subject)).toBe(choice);
  });

  it("has a default and a test row for every subject a decision can have", () => {
    expect(defaults.map(([{ _tag }]) => _tag).toSorted()).toStrictEqual(
      Object.keys(DecisionSubject.cases).toSorted()
    );
  });

  it("sets the default by subject and expires after the policy's days", () => {
    expect(proposalDecision).toStrictEqual({
      deciders: [alice, dana],
      default: "decline",
      evidence,
      expiresAt: at("2026-10-21T12:00:00Z"),
      id: proposalDecision.id,
      openedAt: opened,
      project: scenario.project,
      subject: OpenProposal.make({ proposal }),
    });
  });
});

describe("deciding", () => {
  it("records who chose what, and opens an accepted proposal's ask", () => {
    const result = decide([strayPush, proposalDecision], {
      by: dana,
      choice: "accept",
      id: proposalDecision.id,
      note: Option.some("a good first ask"),
      now: later,
    });

    expect(result).toStrictEqual(
      Result.succeed({
        decision: {
          ...proposalDecision,
          decided: {
            at: later,
            by: dana,
            choice: "accept",
            note: "a good first ask",
          },
        },
        effects: [
          AttentionEffect.OpenAsk({ proposal }),
          AttentionEffect.Emit({
            event: ProjectEventInput.Decided({
              at: later,
              choice: "accept",
              decision: proposalDecision.id,
            }),
          }),
        ],
      })
    );
  });

  it("opens nothing for a declined proposal", () => {
    expect(
      Result.map(choose(proposalDecision, "decline"), ({ effects }) => effects)
    ).toStrictEqual(
      Result.succeed([
        AttentionEffect.Emit({
          event: ProjectEventInput.Decided({
            at: later,
            choice: "decline",
            decision: proposalDecision.id,
          }),
        }),
      ])
    );
  });

  it("reverts a stray push to the commit main had before it", () => {
    expect(
      Result.map(choose(strayPush, "revert"), ({ effects }) => effects)
    ).toStrictEqual(
      Result.succeed([
        AttentionEffect.Revert({ ref: main, to: before }),
        AttentionEffect.Emit({
          event: ProjectEventInput.Decided({
            at: later,
            choice: "revert",
            decision: strayPush.id,
          }),
        }),
      ])
    );
  });

  it("lands an adopted stray push", () => {
    expect(
      Result.map(choose(strayPush, "adopt"), ({ effects }) => effects)
    ).toStrictEqual(
      Result.succeed([
        AttentionEffect.Land({ subject: strayPush.subject }),
        AttentionEffect.Emit({
          event: ProjectEventInput.Decided({
            at: later,
            choice: "adopt",
            decision: strayPush.id,
          }),
        }),
      ])
    );
  });

  it("records a yes or a no in the words its subject uses", () => {
    expect([
      words(strayPush, "accept"),
      words(strayPush, "decline"),
      words(proposalDecision, "adopt"),
      words(proposalDecision, "revert"),
    ]).toStrictEqual([
      Result.succeed("adopt"),
      Result.succeed("revert"),
      Result.succeed("accept"),
      Result.succeed("decline"),
    ]);
  });

  // One rule for handles everywhere (`sameHandle`): the policy's `alice` is
  // the person GitHub signs in as `Alice`.
  it("takes a decision from its decider however sign-in cases the handle", () => {
    expect(
      Result.isSuccess(choose(proposalDecision, "accept", Handle.make("Alice")))
    ).toBeTruthy();
  });

  it("refuses a person who does not decide for it", () => {
    expect(choose(proposalDecision, "accept", bob)).toStrictEqual(
      Result.fail(new NotDecider({}))
    );
  });

  it("refuses a person who does not decide for it before saying it is closed", () => {
    const decided = Result.getOrThrow(choose(proposalDecision, "accept"));

    expect([
      choose(decided.decision, "decline", bob),
      decide([proposalDecision], {
        by: bob,
        choice: "accept",
        id: proposalDecision.id,
        note: Option.none(),
        now: proposalDecision.expiresAt,
      }),
    ]).toStrictEqual([
      Result.fail(new NotDecider({})),
      Result.fail(new NotDecider({})),
    ]);
  });

  it("refuses to decide twice", () => {
    const decided = Result.getOrThrow(choose(proposalDecision, "accept"));

    expect(
      decide([decided.decision], {
        by: dana,
        choice: "decline",
        id: proposalDecision.id,
        note: Option.none(),
        now: later,
      })
    ).toStrictEqual(
      Result.fail(new DecisionClosed({ decision: proposalDecision.id }))
    );
  });

  it("refuses a decision that already reached its expiry", () => {
    expect(
      decide([proposalDecision], {
        by: alice,
        choice: "accept",
        id: proposalDecision.id,
        note: Option.none(),
        now: proposalDecision.expiresAt,
      })
    ).toStrictEqual(
      Result.fail(new DecisionClosed({ decision: proposalDecision.id }))
    );
  });

  it("refuses an id the project never opened", () => {
    const unknown = minted.decision();

    expect(
      decide([], {
        by: alice,
        choice: "accept",
        id: unknown,
        note: Option.none(),
        now: later,
      })
    ).toStrictEqual(Result.fail(new UnknownDecision({ decision: unknown })));
  });
});

describe("a decision nobody took in time", () => {
  const due = DateTime.add(opened, { days: 14 });

  it("takes its default, decided by the platform's own handle", () => {
    const { decisions, effects } = expireDecisions(
      [proposalDecision, strayPush],
      due
    );

    expect(decisions).toStrictEqual([
      {
        ...proposalDecision,
        decided: { at: due, by: platformHandle, choice: "decline" },
      },
      {
        ...strayPush,
        decided: { at: due, by: platformHandle, choice: "revert" },
      },
    ]);

    expect(effects).toStrictEqual([
      AttentionEffect.Emit({
        event: ProjectEventInput.Decided({
          at: due,
          choice: "decline",
          decision: proposalDecision.id,
        }),
      }),
      AttentionEffect.Revert({ ref: main, to: before }),
      AttentionEffect.Emit({
        event: ProjectEventInput.Decided({
          at: due,
          choice: "revert",
          decision: strayPush.id,
        }),
      }),
    ]);
  });

  it("is the platform's handle, made from the brand's slug", () => {
    expect(platformHandle).toBe(Handle.make(Brand.slug));
  });

  it("leaves decisions that are taken or not yet due as they are", () => {
    const decided = Result.getOrThrow(choose(proposalDecision, "accept"));
    const notYet = DateTime.subtract(due, { minutes: 1 });

    expect(expireDecisions([decided.decision, strayPush], due)).toStrictEqual({
      decisions: [
        decided.decision,
        {
          ...strayPush,
          decided: { at: due, by: platformHandle, choice: "revert" },
        },
      ],
      effects: [
        AttentionEffect.Revert({ ref: main, to: before }),
        AttentionEffect.Emit({
          event: ProjectEventInput.Decided({
            at: due,
            choice: "revert",
            decision: strayPush.id,
          }),
        }),
      ],
    });

    expect(expireDecisions([strayPush], notYet)).toStrictEqual({
      decisions: [strayPush],
      effects: [],
    });
  });
});

describe("who decides", () => {
  const policy = {
    ...scenario.policy,
    deciders: [
      { handles: [dana] as const, paths: Glob.make("packages/parser/**") },
      { handles: [alice] as const, paths: Glob.make("**") },
      { handles: [bob, dana] as const, paths: Glob.make("docs/**") },
    ],
  };

  it("is everyone whose glob matches a path, with ** catching all", () => {
    expect(
      decidersFor(policy, [RepoPath.make("packages/parser/src/iso.ts")])
    ).toStrictEqual([dana, alice]);

    expect(
      decidersFor(policy, [RepoPath.make("packages/format/src/week.ts")])
    ).toStrictEqual([alice]);
  });

  it("names each decider once, however many of the paths they hold", () => {
    expect(
      decidersFor(policy, [
        RepoPath.make("docs/iso.md"),
        RepoPath.make("packages/parser/src/iso.ts"),
      ])
    ).toStrictEqual([dana, alice, bob]);
  });

  it("is whoever decides for the whole project when there are no paths", () => {
    expect(decidersFor(policy, [])).toStrictEqual([alice]);
  });
});
