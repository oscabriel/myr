import { describe, expect, it } from "@effect/vitest";
import type { Ask } from "@repo/protocol/domain/ask";
import { Glob } from "@repo/protocol/domain/common";
import type { AskKind } from "@repo/protocol/domain/kind";
import type { Policy } from "@repo/protocol/domain/policy";
import { Handle, LandedSha, ProjectName } from "@repo/protocol/ids";
import { Denounced, NotVouched } from "@repo/protocol/refusal";
import { at } from "@repo/testkit/clock";
import {
  aProject,
  sha,
  withAsk,
  withKind,
  withVouches,
} from "@repo/testkit/scenarios";
import type { AskKindEncoded } from "@repo/testkit/scenarios";
import { Result } from "effect";

import type { RecordEntry } from "../../src/attention/record.ts";
import { mayClaim, mayPropose, standing } from "../../src/attention/vouch.ts";
import type { Standing } from "../../src/attention/vouch.ts";

const now = at("2026-10-07T12:00:00Z");

const fix: AskKindEncoded = {
  checkKind: "redThenGreen",
  claimers: "vouched",
  finish: "optional",
  name: "fix",
  oneWay: false,
  race: 1,
  requires: ["want", "check", "territory"],
  strength: "assertion",
};

/**
 * `datekit`: its file vouches for `bob` and `Erin` and denounces `mallory`;
 * kinds `fix` (vouched), `open` (anyone), `parser` (two held landings in
 * `parser`) and `starter` (newcomers, mentored by alice); an ask of each;
 * asks reserved for newcomers of `fix`, `open` and `parser`; and a `fix` ask
 * reserved for people. The deciders are `alice` alone.
 */
const scenario = aProject({ now }).pipe(
  withVouches(["bob", "Erin"], ["mallory"]),
  withKind({ ...fix, claimers: "anyone", name: "open" }),
  withKind({
    ...fix,
    claimers: { record: { area: "parser", atLeast: 2 } },
    name: "parser",
  }),
  withKind({
    ...fix,
    claimers: { newcomer: { mentor: "alice" } },
    name: "starter",
  }),
  withAsk({ id: "parse-iso", territory: "packages/parser" }),
  withAsk({ id: "open-iso", kind: "open", territory: "packages/parser" }),
  withAsk({ id: "parser-iso", kind: "parser", territory: "packages/parser" }),
  withAsk({ id: "starter-iso", kind: "starter", territory: "packages/parser" }),
  withAsk({
    id: "first-iso",
    reserve: "newcomers",
    territory: "packages/parser",
  }),
  withAsk({
    id: "people-iso",
    reserve: "people",
    territory: "packages/parser",
  }),
  withAsk({
    id: "first-open",
    kind: "open",
    reserve: "newcomers",
    territory: "packages/parser",
  }),
  withAsk({
    id: "first-parser",
    kind: "parser",
    reserve: "newcomers",
    territory: "packages/parser",
  })
);

const { policy } = scenario;

/** The policy with another vouch mode. */
const inMode = (mode: Policy["vouch"]["mode"]): Policy => ({
  ...policy,
  vouch: { ...policy.vouch, mode },
});

const askOf = (id: string): Ask => {
  const ask = policy.asks.find((each) => each.id === id);

  if (ask === undefined) {
    throw new Error(`no ask ${id} in the scenario`);
  }

  return ask;
};

const kindOf = (ask: Ask): AskKind => {
  const kind = policy.kinds.find(({ name }) => name === ask.kind);

  if (kind === undefined) {
    throw new Error(`no kind ${ask.kind} in the scenario`);
  }

  return kind;
};

const alice = Handle.make("alice");

const bob = Handle.make("bob");

const carol = Handle.make("carol");

const mallory = Handle.make("mallory");

/** One held landing on carol's record, in `area` of `project` (datekit's by default). */
const held = (
  area: string,
  seed: string,
  project: ProjectName = scenario.project
): RecordEntry => ({
  area,
  at: now,
  handle: carol,
  landing: LandedSha.make(sha(seed)),
  project,
});

const allowed = Result.void;

const notVouched = Result.fail(new NotVouched({}));

const denounced = Result.fail(new Denounced({}));

/**
 * May a person of this standing, record and landings claim ask `id` under
 * `rules`, with `mentor` named on the ask?
 */
const claim = (
  id: string,
  who: Standing,
  options: {
    readonly landingsInProject?: number;
    readonly mentor?: Handle;
    readonly record?: readonly RecordEntry[];
    readonly rules?: Policy;
  } = {}
) => {
  const ask =
    options.mentor === undefined
      ? askOf(id)
      : { ...askOf(id), mentor: options.mentor };

  return mayClaim({
    ask,
    kind: kindOf(ask),
    landingsInProject: options.landingsInProject ?? 0,
    policy: options.rules ?? policy,
    record: options.record ?? [],
    standing: who,
  });
};

describe("a person's standing", () => {
  it("is vouched for a handle the vouch file vouches for", () => {
    expect(standing(policy, [], bob)).toBe("vouched");
  });

  it("is denounced for a handle the file writes as -handle", () => {
    expect(standing(policy, [], mallory)).toBe("denounced");
  });

  it("is unknown for a handle the file does not name and no decision has", () => {
    expect(standing(policy, [], carol)).toBe("unknown");
  });

  it("is denounced when a denouncement was decided since, even if the file vouches", () => {
    expect(
      standing(policy, [{ at: now, handle: bob, verdict: "denounce" }], bob)
    ).toBe("denounced");
  });

  it("is vouched when a vouch was decided since, for a handle the file does not name", () => {
    expect(
      standing(policy, [{ at: now, handle: carol, verdict: "vouch" }], carol)
    ).toBe("vouched");
  });

  it("takes the latest decision about a person, whatever order they come in", () => {
    const vouchedThenDenounced = [
      { at: at("2026-10-07T13:00:00Z"), handle: carol, verdict: "denounce" },
      { at: at("2026-10-07T12:30:00Z"), handle: carol, verdict: "vouch" },
    ] as const;

    const denouncedThenVouched = [
      { at: at("2026-10-07T13:00:00Z"), handle: mallory, verdict: "vouch" },
      { at: at("2026-10-07T12:30:00Z"), handle: mallory, verdict: "denounce" },
    ] as const;

    expect(standing(policy, vouchedThenDenounced, carol)).toBe("denounced");
    expect(standing(policy, denouncedThenVouched, mallory)).toBe("vouched");
  });

  it("lets a denouncement win over a vouch decided at the same instant", () => {
    const tied = [
      { at: now, handle: carol, verdict: "denounce" },
      { at: now, handle: carol, verdict: "vouch" },
    ] as const;

    expect(standing(policy, tied, carol)).toBe("denounced");
  });

  it("ignores decisions about other people", () => {
    expect(
      standing(policy, [{ at: now, handle: carol, verdict: "denounce" }], bob)
    ).toBe("vouched");
  });

  it("is denounced when the file both vouches for and denounces a handle", () => {
    const both = withVouches(["dave"], ["dave"])(scenario).policy;

    expect(standing(both, [], Handle.make("dave"))).toBe("denounced");
  });

  it("matches handles in any case, as GitHub does", () => {
    expect(standing(policy, [], Handle.make("erin"))).toBe("vouched");
    expect(standing(policy, [], Handle.make("Mallory"))).toBe("denounced");
    expect(
      standing(
        policy,
        [{ at: now, handle: Handle.make("BOB"), verdict: "denounce" }],
        bob
      )
    ).toBe("denounced");
  });
});

describe("who may claim an ask of a vouched kind", () => {
  it("lets a vouched person claim, newcomer or not", () => {
    expect(claim("parse-iso", "vouched")).toStrictEqual(allowed);
    expect(
      claim("parse-iso", "vouched", { landingsInProject: 5 })
    ).toStrictEqual(allowed);
  });

  it("refuses a person nobody vouched for with NotVouched", () => {
    expect(claim("parse-iso", "unknown")).toStrictEqual(notVouched);
  });

  it("refuses a denounced person with Denounced", () => {
    expect(claim("parse-iso", "denounced")).toStrictEqual(denounced);
  });

  it("asks the same under the `all` mode as under `forCode`", () => {
    const all = inMode("all");

    expect(claim("parse-iso", "vouched", { rules: all })).toStrictEqual(
      allowed
    );
    expect(claim("parse-iso", "unknown", { rules: all })).toStrictEqual(
      notVouched
    );
  });
});

describe("who may claim an ask of an anyone kind", () => {
  it("lets a person nobody vouched for claim", () => {
    expect(claim("open-iso", "unknown")).toStrictEqual(allowed);
  });

  it("still refuses a denounced person", () => {
    expect(claim("open-iso", "denounced")).toStrictEqual(denounced);
  });
});

describe("who may claim an ask of a record kind", () => {
  it("lets a person with enough held landings in the area claim, vouched or not", () => {
    const record = [held("parser", "a"), held("parser", "b")];

    expect(claim("parser-iso", "unknown", { record })).toStrictEqual(allowed);
  });

  it("refuses a record short in the area, counting no other area", () => {
    const record = [held("parser", "a"), held("format", "b")];

    expect(claim("parser-iso", "unknown", { record })).toStrictEqual(
      notVouched
    );
  });

  it("counts only landings in the ask's project, not an area of the same name elsewhere", () => {
    const burrow = ProjectName.make("burrow");

    expect(
      claim("parser-iso", "unknown", {
        record: [held("parser", "a", burrow), held("parser", "b", burrow)],
      })
    ).toStrictEqual(notVouched);
    expect(
      claim("parser-iso", "unknown", {
        record: [held("parser", "a"), held("parser", "b", burrow)],
      })
    ).toStrictEqual(notVouched);
  });

  it("does not take a vouch in place of the record", () => {
    expect(claim("parser-iso", "vouched")).toStrictEqual(notVouched);
  });

  it("refuses a denounced person whatever their record", () => {
    const record = [held("parser", "a"), held("parser", "b")];

    expect(claim("parser-iso", "denounced", { record })).toStrictEqual(
      denounced
    );
  });
});

describe("who may claim an ask of a newcomer kind", () => {
  it("lets a newcomer claim with no vouch: the kind names their mentor", () => {
    expect(claim("starter-iso", "unknown")).toStrictEqual(allowed);
  });

  it("refuses someone who has landed in the project: they are no newcomer", () => {
    expect(
      claim("starter-iso", "vouched", { landingsInProject: 1 })
    ).toStrictEqual(notVouched);
  });

  it("refuses a denounced newcomer", () => {
    expect(claim("starter-iso", "denounced")).toStrictEqual(denounced);
  });
});

describe("an ask's reserve", () => {
  it("holds a newcomers ask for people with no landing in the project", () => {
    expect(claim("first-iso", "vouched")).toStrictEqual(allowed);
    expect(
      claim("first-iso", "vouched", { landingsInProject: 3 })
    ).toStrictEqual(notVouched);
    expect(
      claim("first-open", "unknown", { landingsInProject: 1 })
    ).toStrictEqual(notVouched);
  });

  it("narrows who the kind admits: with no mentor named, a newcomer still needs the kind's vouch", () => {
    expect(claim("first-iso", "unknown")).toStrictEqual(notVouched);
    expect(claim("first-open", "unknown")).toStrictEqual(allowed);
  });

  it("lets the mentor a newcomers ask names stand in for the vouch, as the newcomer rule's does", () => {
    expect(claim("first-iso", "unknown", { mentor: alice })).toStrictEqual(
      allowed
    );
    expect(
      claim("first-iso", "unknown", { landingsInProject: 1, mentor: alice })
    ).toStrictEqual(notVouched);
    expect(claim("first-iso", "denounced", { mentor: alice })).toStrictEqual(
      denounced
    );
  });

  it("lets a mentor stand in for a vouch only, not for a kind's record rule", () => {
    expect(claim("first-parser", "unknown", { mentor: alice })).toStrictEqual(
      notVouched
    );
    expect(
      claim("first-parser", "unknown", {
        mentor: alice,
        record: [held("parser", "a"), held("parser", "b")],
      })
    ).toStrictEqual(allowed);
  });

  it("refuses nobody for a people ask: it is a hint for agents' harnesses only", () => {
    const standings: readonly Standing[] = ["vouched", "unknown", "denounced"];

    for (const who of standings) {
      for (const landingsInProject of [0, 4]) {
        expect(claim("people-iso", who, { landingsInProject })).toStrictEqual(
          claim("parse-iso", who, { landingsInProject })
        );
      }
    }

    expect(claim("people-iso", "vouched")).toStrictEqual(allowed);
  });
});

describe("the bansOnly mode", () => {
  const bansOnly = inMode("bansOnly");

  it("lets everyone not denounced claim an ask of a vouched kind", () => {
    expect(claim("parse-iso", "unknown", { rules: bansOnly })).toStrictEqual(
      allowed
    );
    expect(claim("parse-iso", "vouched", { rules: bansOnly })).toStrictEqual(
      allowed
    );
    expect(
      claim("parse-iso", "unknown", { landingsInProject: 9, rules: bansOnly })
    ).toStrictEqual(allowed);
  });

  it("still refuses a denounced person", () => {
    expect(claim("parse-iso", "denounced", { rules: bansOnly })).toStrictEqual(
      denounced
    );
  });

  it("lifts the vouch only, not a kind's record rule or a newcomers reserve", () => {
    expect(claim("parser-iso", "unknown", { rules: bansOnly })).toStrictEqual(
      notVouched
    );
    expect(
      claim("first-iso", "unknown", { landingsInProject: 1, rules: bansOnly })
    ).toStrictEqual(notVouched);
    expect(claim("first-iso", "unknown", { rules: bansOnly })).toStrictEqual(
      allowed
    );
  });
});

describe("who may propose", () => {
  it("lets anyone not denounced propose under forCode, the default", () => {
    expect(mayPropose(policy, "unknown")).toStrictEqual(allowed);
    expect(mayPropose(policy, "vouched")).toStrictEqual(allowed);
    expect(mayPropose(policy, "denounced")).toStrictEqual(denounced);
  });

  it("needs a vouch under the all mode", () => {
    const all = inMode("all");

    expect(mayPropose(all, "unknown")).toStrictEqual(notVouched);
    expect(mayPropose(all, "vouched")).toStrictEqual(allowed);
    expect(mayPropose(all, "denounced")).toStrictEqual(denounced);
  });

  it("refuses only the denounced under bansOnly", () => {
    const bansOnly = inMode("bansOnly");

    expect(mayPropose(bansOnly, "unknown")).toStrictEqual(allowed);
    expect(mayPropose(bansOnly, "denounced")).toStrictEqual(denounced);
  });
});

describe("a decider's standing", () => {
  it("is vouched with no line in the file: deciders are the members who vouch", () => {
    expect(standing(policy, [], alice)).toBe("vouched");
  });

  it("is vouched for a decider of any paths, not only of everything", () => {
    const priya = Handle.make("priya");

    const narrow: Policy = {
      ...policy,
      deciders: [
        ...policy.deciders,
        { handles: [priya], paths: Glob.make("packages/parser/**") },
      ],
    };

    expect(standing(narrow, [], priya)).toBe("vouched");
  });

  it("is denounced when the file or a decision denounces them", () => {
    const denouncedInFile = withVouches([], ["alice"])(scenario).policy;

    expect(standing(denouncedInFile, [], alice)).toBe("denounced");
    expect(
      standing(policy, [{ at: now, handle: alice, verdict: "denounce" }], alice)
    ).toBe("denounced");
  });
});
