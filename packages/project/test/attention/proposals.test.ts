import { describe, expect, it } from "@effect/vitest";
import type { Policy } from "@repo/protocol/domain/policy";
import type { Proposal } from "@repo/protocol/domain/proposal";
import { AskId, Handle, RepoName, RepoPath } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { CapReached, Denounced, NotVouched } from "@repo/protocol/refusal";
import { at } from "@repo/testkit/clock";
import { aProject, ids, sha, withAsk } from "@repo/testkit/scenarios";
import { DateTime, Option, Result } from "effect";

import { AttentionEffect } from "../../src/attention/effects.ts";
import {
  expire,
  ProposalCommand,
  propose,
} from "../../src/attention/proposals.ts";
import { ProjectEventInput } from "../../src/events.ts";

const scenario = aProject({ people: ["carol"] }).pipe(
  withAsk({ id: "parse-iso", territory: "packages/parser" })
);

const carol = Handle.make("carol");

const now = at("2026-10-07T12:00:00Z");

const minted = ids();

const flagged = AskId.make("parse-iso");

const mode = (vouch: Policy["vouch"]["mode"]): Policy => ({
  ...scenario.policy,
  vouch: { ...scenario.policy.vouch, mode: vouch },
});

const sealed = {
  fork: RepoName.make("alice_datekit--me--carol"),
  head: sha("carol's fix for ISO weeks"),
};

/** Carol, vouched, with no proposal open and no record, proposes a new ask. */
const byCarol = (
  standing: Partial<Parameters<typeof ProposalCommand.Propose>[0]> = {}
) =>
  ProposalCommand.Propose({
    denounced: false,
    files: [RepoPath.make("packages/parser/test/iso-week.test.ts")],
    id: minted.proposal(),
    openCount: 0,
    project: scenario.project,
    recordInArea: 0,
    sealed: Option.none(),
    territory: Option.some("parser"),
    vouched: true,
    want: "Parse ISO week dates such as 2026-W40-6",
    who: Person.make({ handle: carol }),
    ...standing,
  });

/** Carol flags the open ask `parse-iso`. */
const flagBy = (
  standing: Partial<Parameters<typeof ProposalCommand.Flag>[0]> = {}
) =>
  ProposalCommand.Flag({
    ask: flagged,
    denounced: false,
    id: minted.proposal(),
    openCount: 0,
    project: scenario.project,
    reason:
      "The check expects Sunday to start the week; ISO weeks start on Monday",
    who: Person.make({ handle: carol }),
    ...standing,
  });

const proposalOf = (command: ProposalCommand, policy = scenario.policy) =>
  Result.map(propose(policy, command, now), ({ proposal }) => proposal);

describe("proposing an ask", () => {
  it("opens a proposal that expires after the policy's days, with an alarm then", () => {
    const command = byCarol();

    expect(propose(scenario.policy, command, now)).toStrictEqual(
      Result.succeed({
        effects: [
          AttentionEffect.SetAlarm({ at: at("2026-10-21T12:00:00Z") }),
          AttentionEffect.Emit({
            event: ProjectEventInput.ProposalOpened({
              at: now,
              proposal: command.id,
            }),
          }),
        ],
        proposal: {
          expiresAt: at("2026-10-21T12:00:00Z"),
          files: [RepoPath.make("packages/parser/test/iso-week.test.ts")],
          id: command.id,
          openedAt: now,
          project: scenario.project,
          proposer: carol,
          state: "open",
          territory: "parser",
          want: "Parse ISO week dates such as 2026-W40-6",
        },
      })
    );
  });

  it("refuses a person who already has the cap's proposals open", () => {
    expect(proposalOf(byCarol({ openCount: 2 }))).toStrictEqual(
      Result.fail(new CapReached({ cap: 2, limit: "proposals" }))
    );
  });

  it("lets a person with one fewer than the cap open propose", () => {
    expect(
      Result.map(proposalOf(byCarol({ openCount: 1 })), ({ state }) => state)
    ).toStrictEqual(Result.succeed("open"));
  });

  it("refuses a denounced person, whatever the vouch mode", () => {
    expect([
      proposalOf(byCarol({ denounced: true })),
      proposalOf(byCarol({ denounced: true }), mode("bansOnly")),
    ]).toStrictEqual([
      Result.fail(new Denounced({})),
      Result.fail(new Denounced({})),
    ]);
  });

  it("refuses an unvouched person when the project's vouch gates everything", () => {
    expect(proposalOf(byCarol({ vouched: false }), mode("all"))).toStrictEqual(
      Result.fail(new NotVouched({}))
    );
  });

  it("refuses a denouncement first, then a missing vouch, and the cap last", () => {
    const everything = mode("all");

    expect([
      proposalOf(
        byCarol({ denounced: true, openCount: 2, vouched: false }),
        everything
      ),
      proposalOf(byCarol({ openCount: 2, vouched: false }), everything),
    ]).toStrictEqual([
      Result.fail(new Denounced({})),
      Result.fail(new NotVouched({})),
    ]);
  });

  it("lets an unvouched person propose when the vouch gates only code", () => {
    expect(
      Result.map(
        proposalOf(byCarol({ vouched: false }), mode("forCode")),
        ({ state }) => state
      )
    ).toStrictEqual(Result.succeed("open"));
  });
});

describe("a proposal with a sealed answer", () => {
  it("keeps the first-answer slot when the proposer has a record in the area", () => {
    expect(
      Result.map(
        proposalOf(byCarol({ recordInArea: 1, sealed: Option.some(sealed) })),
        (proposal) => proposal.sealed
      )
    ).toStrictEqual(Result.succeed(sealed));
  });

  it("opens the ask to all, with Asked-by credit only, when the proposer has no record there", () => {
    const result = proposalOf(
      byCarol({ recordInArea: 0, sealed: Option.some(sealed) })
    );

    expect(
      Result.map(result, (proposal) => "sealed" in proposal)
    ).toStrictEqual(Result.succeed(false));

    expect(Result.map(result, ({ proposer }) => proposer)).toStrictEqual(
      Result.succeed(carol)
    );
  });

  it("needs a vouch when the vouch gates code, and none when it bans only", () => {
    const unvouched = byCarol({
      recordInArea: 1,
      sealed: Option.some(sealed),
      vouched: false,
    });

    expect(proposalOf(unvouched, mode("forCode"))).toStrictEqual(
      Result.fail(new NotVouched({}))
    );

    expect(
      Result.map(
        proposalOf(unvouched, mode("bansOnly")),
        (proposal) => proposal.sealed
      )
    ).toStrictEqual(Result.succeed(sealed));
  });
});

describe("flagging an ask", () => {
  it("makes a proposal whose flags is that ask, with the reason as its want", () => {
    const command = flagBy();

    expect(proposalOf(command)).toStrictEqual(
      Result.succeed({
        expiresAt: at("2026-10-21T12:00:00Z"),
        files: [],
        flags: flagged,
        id: command.id,
        openedAt: now,
        project: scenario.project,
        proposer: carol,
        state: "open",
        want: "The check expects Sunday to start the week; ISO weeks start on Monday",
      })
    );
  });

  it("needs no vouch, even when the vouch gates everything", () => {
    expect(
      Result.map(proposalOf(flagBy(), mode("all")), ({ flags }) => flags)
    ).toStrictEqual(Result.succeed(flagged));
  });

  it("counts against the same cap, and is refused to a denounced person", () => {
    expect([
      proposalOf(flagBy({ openCount: 2 })),
      proposalOf(flagBy({ denounced: true })),
    ]).toStrictEqual([
      Result.fail(new CapReached({ cap: 2, limit: "proposals" })),
      Result.fail(new Denounced({})),
    ]);
  });
});

/** A proposal opened now, and one opened now and accepted since. */
const proposals = () => {
  const opened = Result.getOrThrow(proposalOf(byCarol()));

  const accepted: Proposal = {
    ...Result.getOrThrow(proposalOf(byCarol())),
    state: "accepted",
  };

  return { accepted, opened };
};

describe("a proposal nobody accepted in time", () => {
  it("expires on the tick at its expiry", () => {
    const { accepted, opened } = proposals();

    expect(expire([opened, accepted], opened.expiresAt)).toStrictEqual({
      effects: [],
      proposals: [{ ...opened, state: "expired" }, accepted],
    });
  });

  it("stays open on a tick before its expiry", () => {
    const { opened } = proposals();
    const early = DateTime.subtract(opened.expiresAt, { seconds: 1 });

    expect(expire([opened], early)).toStrictEqual({
      effects: [],
      proposals: [opened],
    });
  });
});
