import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import type { Ask } from "@repo/protocol/domain/ask";
import type { Credit, CreditRole } from "@repo/protocol/domain/credit";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { CreditSummary } from "@repo/protocol/domain/record";
import { AskId, Handle, LandedSha, ProjectName } from "@repo/protocol/ids";
import { at } from "@repo/testkit/clock";
import { aProject, sha, withAsk } from "@repo/testkit/scenarios";
import type { Scenario } from "@repo/testkit/scenarios";

import { creditsByArea } from "../../src/attention/credits.ts";

const now = at("2026-10-07T12:00:00Z");

/** `datekit`: asks in `packages/parser` and `packages/format`. */
const datekit = aProject({ now }).pipe(
  withAsk({ id: "parse-iso", territory: "packages/parser" }),
  withAsk({ id: "format-week", territory: "packages/format" })
);

/** `burrow`: an ask in `packages/p1`. */
const burrow = aProject({ name: "alice/burrow", now }).pipe(
  withAsk({ id: "drop-legacy-p1", territory: "packages/p1" })
);

const asks: ReadonlyMap<AskId, Ask> = new Map(
  [...datekit.policy.asks, ...burrow.policy.asks].map((ask) => [ask.id, ask])
);

const alice = Handle.make("alice");

const bob = Handle.make("bob");

const carol = Handle.make("carol");

const credit = (role: CreditRole, handle: Handle): Credit => ({
  handle,
  role,
});

/** A landing in `scenario` answering `ask` (none: a decider's own landing), with these trailers. */
const landing = (
  scenario: Scenario,
  seed: string,
  ask: string | undefined,
  credits: readonly Credit[],
  assisted: LandingView["assisted"] = []
): LandingView => {
  const view: LandingView = {
    assisted,
    author: bob,
    credits,
    landedAt: now,
    parent: scenario.landed,
    project: scenario.project,
    sha: LandedSha.make(sha(seed)),
  };

  return ask === undefined ? view : { ...view, ask: AskId.make(ask) };
};

const row = (
  project: string,
  area: string,
  role: CreditRole,
  count: number
): CreditSummary => ({
  area,
  count,
  project: ProjectName.make(project),
  role,
});

describe("a person's credits", () => {
  it("counts each role they hold by project and area, sorted by project, area and role", () => {
    const landings = [
      landing(datekit, "one", "parse-iso", [
        credit("Asked-by", alice),
        credit("Signed-off-by", bob),
        credit("Decided-by", alice),
      ]),
      landing(datekit, "two", "parse-iso", [
        credit("Asked-by", alice),
        credit("Mentored-by", alice),
        credit("Signed-off-by", carol),
      ]),
      landing(datekit, "three", "format-week", [
        credit("Signed-off-by", alice),
        credit("Finished-by", alice),
      ]),
      landing(burrow, "four", "drop-legacy-p1", [
        credit("Released-by", alice),
        credit("Advised-by", alice),
      ]),
      landing(datekit, "five", "parse-iso", [credit("Asked-by", bob)]),
    ];

    expect(creditsByArea({ asks, handle: alice, landings })).toStrictEqual([
      row("alice/burrow", "p1", "Advised-by", 1),
      row("alice/burrow", "p1", "Released-by", 1),
      row("alice/datekit", "format", "Finished-by", 1),
      row("alice/datekit", "format", "Signed-off-by", 1),
      row("alice/datekit", "parser", "Asked-by", 2),
      row("alice/datekit", "parser", "Decided-by", 1),
      row("alice/datekit", "parser", "Mentored-by", 1),
    ]);
  });

  it("counts every one of the seven roles", () => {
    const all = landing(datekit, "all", "parse-iso", [
      credit("Asked-by", alice),
      credit("Signed-off-by", alice),
      credit("Decided-by", alice),
      credit("Mentored-by", alice),
      credit("Finished-by", alice),
      credit("Advised-by", alice),
      credit("Released-by", alice),
    ]);

    expect(
      creditsByArea({ asks, handle: alice, landings: [all] })
    ).toStrictEqual([
      row("alice/datekit", "parser", "Advised-by", 1),
      row("alice/datekit", "parser", "Asked-by", 1),
      row("alice/datekit", "parser", "Decided-by", 1),
      row("alice/datekit", "parser", "Finished-by", 1),
      row("alice/datekit", "parser", "Mentored-by", 1),
      row("alice/datekit", "parser", "Released-by", 1),
      row("alice/datekit", "parser", "Signed-off-by", 1),
    ]);
  });

  it("counts a landing once per role, however many times a trailer repeats", () => {
    const twice = landing(datekit, "twice", "parse-iso", [
      credit("Signed-off-by", alice),
      credit("Signed-off-by", alice),
    ]);

    expect(
      creditsByArea({ asks, handle: alice, landings: [twice] })
    ).toStrictEqual([row("alice/datekit", "parser", "Signed-off-by", 1)]);
  });

  it("never counts Assisted-by: agent help is disclosed, not credited", () => {
    const helped = landing(
      datekit,
      "helped",
      "parse-iso",
      [credit("Signed-off-by", alice)],
      [
        { harness: "claude-code", model: "opus", verified: true },
        { harness: "pi", verified: false },
      ]
    );

    const alone = landing(datekit, "alone", "parse-iso", [
      credit("Signed-off-by", alice),
    ]);

    expect(
      creditsByArea({ asks, handle: alice, landings: [helped, alone] })
    ).toStrictEqual([row("alice/datekit", "parser", "Signed-off-by", 2)]);
    expectTypeOf<"Assisted-by">().not.toExtend<CreditSummary["role"]>();
  });

  it("counts nothing for a landing with no area: no ask, or an ask it can't find", () => {
    const landings = [
      landing(datekit, "own", undefined, [credit("Signed-off-by", alice)]),
      landing(datekit, "lost", "gone", [credit("Asked-by", alice)]),
    ];

    expect(creditsByArea({ asks, handle: alice, landings })).toStrictEqual([]);
  });

  it("is empty for a person no trailer names", () => {
    const landings = [
      landing(datekit, "one", "parse-iso", [credit("Asked-by", alice)]),
    ];

    expect(
      creditsByArea({ asks, handle: Handle.make("dave"), landings })
    ).toStrictEqual([]);
  });

  it("holds roles and counts by area, and no field shaped like a score", () => {
    expectTypeOf<keyof CreditSummary>().toEqualTypeOf<
      "area" | "count" | "project" | "role"
    >();
    expectTypeOf<
      keyof ReturnType<typeof creditsByArea>[number]
    >().toEqualTypeOf<"area" | "count" | "project" | "role">();
    expectTypeOf<CreditSummary["count"]>().toEqualTypeOf<number>();
  });
});
