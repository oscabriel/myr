import { describe, expect, it } from "@effect/vitest";
import { ClaimView } from "@repo/protocol/domain/claim";
import {
  AskId,
  CommitSha,
  Handle,
  LandedSha,
  ProjectName,
  RepoName,
} from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import {
  AskBlocked,
  AskFull,
  CapReached,
  ClaimLapsed,
  Denounced,
  NotClaimed,
  NotVouched,
} from "@repo/protocol/refusal";
import { DateTime, Option, Result, Schema } from "effect";

import {
  ClaimCommand,
  ClaimEffect,
  ClaimState,
  forkName,
  toView,
  transition,
} from "../src/claim.ts";
import { ProjectEventInput } from "../src/events.ts";

const { Claim, Land, Push, Release, Tick } = ClaimCommand.cases;

const HOUR = 3_600_000;

/** The defaults: warned after 2 quiet hours, lapsed after 24. */
const policy = { lapseAfterMs: 24 * HOUR, warnAfterMs: 2 * HOUR };

const project = ProjectName.make("alice/datekit");

const ask = AskId.make("parse-iso");

const blocker = AskId.make("drop-legacy");

const base = CommitSha.make("1".repeat(40));

const head = CommitSha.make("2".repeat(40));

const landing = LandedSha.make("3".repeat(40));

const bob = Handle.make("Bob");

const carol = Handle.make("carol");

/** Bob's fork: his handle in lowercase. */
const fork = RepoName.make("alice__datekit--parse-iso--bob");

const start = DateTime.makeUnsafe("2026-10-07T12:00:00Z");

/** `hours` after the claim was made. */
const at = (hours: number) => DateTime.add(start, { hours });

/** A claim by a vouched person under their cap, on an ask nobody holds. */
const claimBy = (
  handle: Handle,
  standing: Partial<Omit<typeof Claim.Type, "_tag" | "who">> = {}
) =>
  Claim.make({
    base,
    blockedBy: [],
    cap: 3,
    denounced: false,
    heldByWho: 0,
    liveCount: 0,
    project,
    race: 1,
    vouched: true,
    who: Person.make({ handle }),
    ...standing,
  });

const open = ClaimState.cases.Open.make({ ask });

/** Bob's claim, made at `start`, never pushed to. */
const fresh = {
  ask,
  base,
  claimant: bob,
  fork,
  lapsesAt: at(24),
  lastPushAt: Option.none(),
  openedAt: start,
  warnsAt: at(2),
};

const live = ClaimState.cases.Live.make(fresh);

const warned = ClaimState.cases.Warned.make(fresh);

const lapsed = ClaimState.cases.Lapsed.make({ ...fresh, at: at(24) });

const step = (state: ClaimState, effects: readonly ClaimEffect[] = []) =>
  Result.succeed({ effects, state });

describe("claiming an ask", () => {
  it("gives a vouched person under their cap a live claim, a fork and a warn alarm", () => {
    expect(transition(open, claimBy(bob), start, policy)).toStrictEqual(
      step(live, [
        ClaimEffect.MakeFork({
          from: RepoName.make("alice__datekit"),
          name: fork,
        }),
        ClaimEffect.SetAlarm({ at: at(2) }),
        ClaimEffect.Emit({
          event: ProjectEventInput.Claimed({ ask, at: start, claimant: bob }),
        }),
      ])
    );
  });

  it("names the fork after the project, the ask and the handle in lowercase", () => {
    expect(forkName(project, ask, bob)).toBe("alice__datekit--parse-iso--bob");
  });

  it("refuses a second person with AskFull, and forks nothing", () => {
    expect(transition(live, claimBy(carol), at(1), policy)).toStrictEqual(
      Result.fail(new AskFull({ ask }))
    );
  });

  it("refuses with AskFull when others hold every claim the kind allows", () => {
    expect(
      transition(open, claimBy(carol, { liveCount: 2, race: 2 }), at(1), policy)
    ).toStrictEqual(Result.fail(new AskFull({ ask })));
  });

  it("lets a racing kind take another claim while it has room", () => {
    const result = transition(
      open,
      claimBy(carol, { liveCount: 1, race: 2 }),
      at(1),
      policy
    );

    expect(Result.map(result, ({ state }) => state._tag)).toStrictEqual(
      Result.succeed("Live")
    );
  });

  it("leaves the holder's own claim as it is when they claim again", () => {
    expect(transition(live, claimBy(bob), at(1), policy)).toStrictEqual(
      step(live)
    );
    expect(transition(warned, claimBy(bob), at(3), policy)).toStrictEqual(
      step(warned)
    );
  });

  it("refuses an ask that waits on others with AskBlocked", () => {
    expect(
      transition(open, claimBy(bob, { blockedBy: [blocker] }), start, policy)
    ).toStrictEqual(Result.fail(AskBlocked.of(ask, [blocker])));
  });

  it("refuses a person at their cap with CapReached", () => {
    expect(
      transition(open, claimBy(bob, { heldByWho: 3 }), start, policy)
    ).toStrictEqual(Result.fail(new CapReached({ cap: 3 })));
  });

  it("refuses an unvouched person with NotVouched", () => {
    expect(
      transition(open, claimBy(bob, { vouched: false }), start, policy)
    ).toStrictEqual(Result.fail(new NotVouched({})));
  });

  it("refuses a denounced person with Denounced, before NotVouched", () => {
    expect(
      transition(
        open,
        claimBy(bob, { denounced: true, vouched: false }),
        start,
        policy
      )
    ).toStrictEqual(Result.fail(new Denounced({})));
  });

  it("names only the first refusal a claim meets: blockers, then the cap, then standing", () => {
    const troubled = {
      blockedBy: [blocker],
      denounced: true,
      heldByWho: 3,
      vouched: false,
    };

    expect(
      transition(open, claimBy(bob, troubled), start, policy)
    ).toStrictEqual(Result.fail(AskBlocked.of(ask, [blocker])));
    expect(
      transition(
        open,
        claimBy(bob, { ...troubled, blockedBy: [] }),
        start,
        policy
      )
    ).toStrictEqual(Result.fail(new CapReached({ cap: 3 })));
  });

  it("says AskFull before anything else, so a full ask never forks", () => {
    expect(
      transition(
        live,
        claimBy(carol, {
          blockedBy: [blocker],
          denounced: true,
          heldByWho: 3,
          vouched: false,
        }),
        at(1),
        policy
      )
    ).toStrictEqual(Result.fail(new AskFull({ ask })));
  });

  it("gives a lapsed claim to the next person, with their own fork", () => {
    const result = transition(lapsed, claimBy(carol), at(25), policy);

    expect(Result.map(result, ({ effects }) => effects[0])).toStrictEqual(
      Result.succeed(
        ClaimEffect.MakeFork({
          from: RepoName.make("alice__datekit"),
          name: RepoName.make("alice__datekit--parse-iso--carol"),
        })
      )
    );
  });

  it("refuses any claim on an answered ask with AskFull", () => {
    const answered = ClaimState.cases.Answered.make({ ...fresh, landing });

    expect(transition(answered, claimBy(bob), at(3), policy)).toStrictEqual(
      Result.fail(new AskFull({ ask }))
    );
  });
});

describe("pushing keeps a claim alive", () => {
  it("moves both deadlines on from the push and sets the alarm", () => {
    expect(
      transition(live, Push.make({ head, who: bob }), at(1), policy)
    ).toStrictEqual(
      step(
        ClaimState.cases.Live.make({
          ...fresh,
          lapsesAt: at(25),
          lastPushAt: Option.some(at(1)),
          warnsAt: at(3),
        }),
        [
          ClaimEffect.SetAlarm({ at: at(3) }),
          ClaimEffect.Emit({
            event: ProjectEventInput.Pushed({ ask, at: at(1), head }),
          }),
        ]
      )
    );
  });

  it("makes a warned claim live again", () => {
    const result = transition(
      warned,
      Push.make({ head, who: bob }),
      at(5),
      policy
    );

    expect(Result.map(result, ({ state }) => state._tag)).toStrictEqual(
      Result.succeed("Live")
    );
  });

  it("refuses a push from someone who holds no claim with NotClaimed", () => {
    expect(
      transition(live, Push.make({ head, who: carol }), at(1), policy)
    ).toStrictEqual(Result.fail(NotClaimed.of(ask)));
    expect(
      transition(open, Push.make({ head, who: bob }), at(1), policy)
    ).toStrictEqual(Result.fail(NotClaimed.of(ask)));
  });

  it("refuses the lapsed claimant's push with ClaimLapsed", () => {
    expect(
      transition(lapsed, Push.make({ head, who: bob }), at(25), policy)
    ).toStrictEqual(Result.fail(ClaimLapsed.of(ask)));
  });
});

describe("an alarm", () => {
  it("does nothing before the warn deadline", () => {
    expect(transition(live, Tick.make({}), at(1), policy)).toStrictEqual(
      step(live)
    );
  });

  it("warns a claim at its warn deadline and sets the lapse alarm", () => {
    expect(transition(live, Tick.make({}), at(2), policy)).toStrictEqual(
      step(warned, [
        ClaimEffect.SetAlarm({ at: at(24) }),
        ClaimEffect.Emit({
          event: ProjectEventInput.Warned({ ask, at: at(2) }),
        }),
      ])
    );
  });

  it("lapses a warned claim at its lapse deadline and revokes the fork", () => {
    expect(transition(warned, Tick.make({}), at(24), policy)).toStrictEqual(
      step(lapsed, [
        ClaimEffect.RevokeAccess({ fork }),
        ClaimEffect.Emit({
          event: ProjectEventInput.Lapsed({ ask, at: at(24) }),
        }),
      ])
    );
  });

  it("lapses a live claim straight away when the alarm comes after both deadlines", () => {
    const result = transition(live, Tick.make({}), at(30), policy);

    expect(Result.map(result, ({ state }) => state._tag)).toStrictEqual(
      Result.succeed("Lapsed")
    );
  });

  it("leaves a warned claim alone before its lapse deadline", () => {
    expect(transition(warned, Tick.make({}), at(23), policy)).toStrictEqual(
      step(warned)
    );
  });
});

describe("releasing a claim", () => {
  it("ends the holder's claim and revokes the fork", () => {
    expect(
      transition(live, Release.make({ who: bob }), at(1), policy)
    ).toStrictEqual(
      step(ClaimState.cases.Released.make(fresh), [
        ClaimEffect.RevokeAccess({ fork }),
        ClaimEffect.Emit({
          event: ProjectEventInput.Released({ ask, at: at(1) }),
        }),
      ])
    );
  });

  it("refuses anyone but the holder with NotClaimed", () => {
    expect(
      transition(live, Release.make({ who: carol }), at(1), policy)
    ).toStrictEqual(Result.fail(NotClaimed.of(ask)));
  });

  it("converges when the holder releases twice", () => {
    const released = ClaimState.cases.Released.make(fresh);

    expect(
      transition(released, Release.make({ who: bob }), at(2), policy)
    ).toStrictEqual(step(released));
  });
});

describe("landing the claimant's answer", () => {
  it("answers the claim and revokes the fork", () => {
    expect(
      transition(live, Land.make({ landing }), at(3), policy)
    ).toStrictEqual(
      step(ClaimState.cases.Answered.make({ ...fresh, landing }), [
        ClaimEffect.RevokeAccess({ fork }),
      ])
    );
  });

  it("converges when the landing is told twice", () => {
    const answered = ClaimState.cases.Answered.make({ ...fresh, landing });

    expect(
      transition(answered, Land.make({ landing }), at(4), policy)
    ).toStrictEqual(step(answered));
  });
});

describe("the claim's view", () => {
  const context = {
    checkCommand: "bun test test/parse-iso.test.ts",
    project,
    remote: "https://platform.example/datekit--parse-iso--bob.git",
  };

  it("shows a live claim with its fork, remote and deadlines", () => {
    expect(toView(live, context)).toStrictEqual(
      Option.some(
        ClaimView.make({
          ask,
          base,
          checkCommand: context.checkCommand,
          claimant: bob,
          fork,
          lapsesAt: at(24),
          openedAt: start,
          project,
          remote: context.remote,
          state: "live",
          warnsAt: at(2),
        })
      )
    );
  });

  it("names the state the claim ended in, and its last push", () => {
    const pushed = { ...fresh, lastPushAt: Option.some(at(1)) };

    expect(
      Option.map(
        toView(
          ClaimState.cases.Lapsed.make({ ...pushed, at: at(25) }),
          context
        ),
        ({ lastPushAt, state }) => ({ lastPushAt, state })
      )
    ).toStrictEqual(Option.some({ lastPushAt: at(1), state: "lapsed" }));
  });

  it("has no view while the ask holds no claim", () => {
    expect(toView(open, context)).toStrictEqual(Option.none());
  });
});

describe("the persisted state", () => {
  it("round-trips through JSON text", () => {
    const pushed = ClaimState.cases.Warned.make({
      ...fresh,
      lastPushAt: Option.some(at(1)),
    });

    const Stored = Schema.fromJsonString(ClaimState);
    const text = Schema.encodeSync(Stored)(pushed);

    expect(Schema.decodeSync(Stored)(text)).toStrictEqual(pushed);
  });

  it("is JSON with times as text, and leaves out a push that never came", () => {
    const stored = Schema.encodeSync(ClaimState)(live);

    expect(stored).toHaveProperty("lapsesAt", "2026-10-08T12:00:00.000Z");
    expect(stored).not.toHaveProperty("lastPushAt");
  });
});
