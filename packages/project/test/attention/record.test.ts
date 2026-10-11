import { describe, expect, it } from "@effect/vitest";
import type { Ask } from "@repo/protocol/domain/ask";
import type { LandingView } from "@repo/protocol/domain/landing";
import { AskId, Handle, LandedSha, ProjectName } from "@repo/protocol/ids";
import { at } from "@repo/testkit/clock";
import { aProject, sha, withAsk } from "@repo/testkit/scenarios";
import { DateTime } from "effect";

import { meets, recordOf } from "../../src/attention/record.ts";

const now = at("2026-10-07T12:00:00Z");

/** `datekit`, with an ask in `packages/parser` and one in `packages/format`. */
const scenario = aProject({ now, people: ["bob"] }).pipe(
  withAsk({ id: "parse-iso", territory: "packages/parser" }),
  withAsk({ id: "parse-week", territory: "packages/parser" }),
  withAsk({ id: "format-week", territory: "packages/format" })
);

const asks: ReadonlyMap<AskId, Ask> = new Map(
  scenario.policy.asks.map((ask) => [ask.id, ask])
);

const alice = Handle.make("alice");

const bob = Handle.make("bob");

/** A landing `days` before `now`, by `author`, answering `ask` (none: a decider's own landing). */
const landing = (
  seed: string,
  options: {
    readonly ask?: string;
    readonly author?: Handle;
    readonly days: number;
  }
): LandingView => {
  const view: LandingView = {
    assisted: [],
    author: options.author ?? alice,
    credits: [],
    landedAt: DateTime.subtract(now, { days: options.days }),
    parent: scenario.landed,
    project: scenario.project,
    sha: LandedSha.make(sha(seed)),
  };

  return options.ask === undefined
    ? view
    : { ...view, ask: AskId.make(options.ask) };
};

/** Alice's record as it stands at `now` under the default window (30 days, 365 days). */
const recordAt = (
  landings: readonly LandingView[],
  reverted: readonly LandingView[] = []
) =>
  recordOf({
    asks,
    landings,
    now,
    policy: scenario.policy.record,
    reverted: new Set(reverted.map(({ sha: landed }) => landed)),
  });

describe("a person's record", () => {
  it("counts a landing that stayed unreverted for 31 days, in its ask's module", () => {
    const held = landing("held", { ask: "parse-iso", days: 31 });

    expect(recordAt([held])(alice)).toStrictEqual([
      {
        area: "parser",
        at: held.landedAt,
        handle: alice,
        landing: held.sha,
        project: scenario.project,
      },
    ]);
  });

  it("does not count a landing 29 days old yet", () => {
    expect(
      recordAt([landing("young", { ask: "parse-iso", days: 29 })])(alice)
    ).toStrictEqual([]);
  });

  it("counts a landing from the day it is exactly 30 days old", () => {
    expect(
      recordAt([landing("thirty", { ask: "parse-iso", days: 30 })])(alice)
    ).toHaveLength(1);
  });

  it("no longer counts a landing 400 days old", () => {
    expect(
      recordAt([landing("old", { ask: "parse-iso", days: 400 })])(alice)
    ).toStrictEqual([]);
  });

  it("still counts a landing exactly 365 days old, the window's last day", () => {
    expect(
      recordAt([landing("year", { ask: "parse-iso", days: 365 })])(alice)
    ).toHaveLength(1);
  });

  it("does not count a landing that was reverted", () => {
    const reverted = landing("reverted", { ask: "parse-iso", days: 60 });

    expect(recordAt([reverted], [reverted])(alice)).toStrictEqual([]);
  });

  it("counts a landing for no area when it answered no ask", () => {
    expect(recordAt([landing("own", { days: 60 })])(alice)).toStrictEqual([]);
  });

  it("counts a landing for no area when its ask is unknown", () => {
    expect(
      recordAt([landing("lost", { ask: "gone", days: 60 })])(alice)
    ).toStrictEqual([]);
  });

  it("takes no area from another project's ask with the same id", () => {
    const elsewhere = {
      ...landing("elsewhere", { ask: "parse-iso", days: 60 }),
      project: ProjectName.make("alice/burrow"),
    };

    expect(recordAt([elsewhere])(alice)).toStrictEqual([]);
  });

  it("files each landing under its own ask's module", () => {
    const record = recordAt([
      landing("a", { ask: "parse-iso", days: 40 }),
      landing("b", { ask: "format-week", days: 50 }),
    ])(alice);

    expect(record.map(({ area }) => area)).toStrictEqual(["parser", "format"]);
  });

  it("holds only the landings its person is accountable for", () => {
    const record = recordAt([
      landing("alice's", { ask: "parse-iso", days: 40 }),
      landing("bob's", { ask: "parse-week", author: bob, days: 40 }),
    ]);

    expect(record(alice).map(({ handle }) => handle)).toStrictEqual([alice]);
    expect(record(bob).map(({ handle }) => handle)).toStrictEqual([bob]);
    expect(record(Handle.make("carol"))).toStrictEqual([]);
    // A valid handle that is also a property of every plain object.
    expect(record(Handle.make("constructor"))).toStrictEqual([]);
  });

  it("finds a person by their handle in any case, as GitHub does", () => {
    const record = recordAt([landing("held", { ask: "parse-iso", days: 40 })]);

    expect(record(Handle.make("Alice"))).toStrictEqual(record(alice));
    expect(record(alice)).toHaveLength(1);
  });
});

describe("a record rule", () => {
  const record = recordAt([
    landing("a", { ask: "parse-iso", days: 40 }),
    landing("b", { ask: "parse-week", days: 90 }),
    landing("c", { ask: "format-week", days: 40 }),
    landing("young", { ask: "parse-iso", days: 3 }),
  ])(alice);

  it("is met by enough held landings in its area", () => {
    expect(meets(record, { area: "parser", atLeast: 1 })).toBeTruthy();
    expect(meets(record, { area: "parser", atLeast: 2 })).toBeTruthy();
  });

  it("is not met by too few, nor by landings in another area", () => {
    expect(meets(record, { area: "parser", atLeast: 3 })).toBeFalsy();
    expect(meets(record, { area: "format", atLeast: 2 })).toBeFalsy();
    expect(meets(record, { area: "cli", atLeast: 1 })).toBeFalsy();
  });

  it("is not met by an empty record", () => {
    expect(meets([], { area: "parser", atLeast: 1 })).toBeFalsy();
  });
});
