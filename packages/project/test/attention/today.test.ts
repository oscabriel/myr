import { describe, expect, it } from "@effect/vitest";
import { Glob } from "@repo/protocol/domain/common";
import type { CreditRole } from "@repo/protocol/domain/credit";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import type { LandingView } from "@repo/protocol/domain/landing";
import { AskId, Handle, LandedSha, RepoPath } from "@repo/protocol/ids";
import { at } from "@repo/testkit/clock";
import { aProject, ids, sha, withAsk } from "@repo/testkit/scenarios";
import { Array as Arr, DateTime, Option, Result } from "effect";

import {
  decide,
  decidersFor,
  openDecision,
} from "../../src/attention/decisions.ts";
import { today } from "../../src/attention/today.ts";

const scenario = aProject({
  deciders: ["alice", "dana"],
  people: ["bob", "carol", "erin", "frank"],
}).pipe(withAsk({ id: "parse-iso", territory: "packages/parser" }));

const handle = (name: string) => Handle.make(name);

const alice = handle("alice");

const dana = handle("dana");

const now = at("2026-10-08T12:00:00Z");

const minted = ids();

const vouchFor = (name: string, expiresIn: number): Decision =>
  openDecision({
    deciders: [alice, dana],
    evidence: [],
    expireDays: 14,
    id: minted.decision(),
    now: DateTime.add(now, { days: -14, hours: expiresIn }),
    project: scenario.project,
    subject: DecisionSubject.cases.Vouch.make({ handle: handle(name) }),
  });

// Eight open decisions, numbered in the order they expire: 3 h to 200 h from now.
const p1 = vouchFor("p1", 3);

const p2 = vouchFor("p2", 20);

const p3 = vouchFor("p3", 30);

const p4 = vouchFor("p4", 50);

const p5 = vouchFor("p5", 100);

const p6 = vouchFor("p6", 120);

const p7 = vouchFor("p7", 150);

const p8 = vouchFor("p8", 200);

const eight = [p5, p1, p8, p3, p2, p7, p4, p6];

const todayFor = (
  input: Partial<Parameters<typeof today>[0]> & {
    readonly decisions: readonly Decision[];
  }
) =>
  today({
    decider: alice,
    firstClaims: [],
    landings: [],
    now,
    ...input,
  });

describe("a maintainer's Today", () => {
  it("shows every open decision, the ones that expire first first, and holds none back", () => {
    const page = todayFor({ decisions: eight });

    expect(page.decisions).toStrictEqual([p1, p2, p3, p4, p5, p6, p7, p8]);
    expect(page.decider).toBe(alice);
  });

  it("shows a maintainer their decisions however sign-in cases the handle", () => {
    const page = todayFor({ decider: handle("ALICE"), decisions: eight });

    expect(page.decisions).toStrictEqual([p1, p2, p3, p4, p5, p6, p7, p8]);
  });

  it("calls out every decision expiring within 24 hours", () => {
    const page = todayFor({ decisions: eight });

    expect(page.expiringSoon).toStrictEqual([p1.id, p2.id]);
  });

  it("leaves out decisions already taken, and those past their expiry", () => {
    // p1 was taken; p2 reaches its expiry at +20 h.
    const taken = Result.getOrThrow(
      decide(eight, {
        by: dana,
        choice: "accept",
        id: p1.id,
        note: Option.none(),
        now,
      })
    );

    const page = todayFor({
      decisions: eight.map((decision) =>
        decision.id === taken.decision.id ? taken.decision : decision
      ),
      now: DateTime.add(now, { hours: 20 }),
    });

    expect(page.decisions).toStrictEqual([p3, p4, p5, p6, p7, p8]);
  });

  it("leaves out decisions for paths the maintainer does not own", () => {
    const policy = {
      ...scenario.policy,
      deciders: [
        { handles: [dana] as const, paths: Glob.make("packages/parser/**") },
        { handles: [alice] as const, paths: Glob.make("packages/format/**") },
      ],
    };

    // A path no glob matches would go to nobody either of them is.
    const nobody = handle("nobody");

    const forPaths = (path: string, ask: string) => {
      const owners = decidersFor(policy, [RepoPath.make(path)]);

      return openDecision({
        deciders: Arr.isReadonlyArrayNonEmpty(owners) ? owners : [nobody],
        evidence: [],
        expireDays: 14,
        id: minted.decision(),
        now,
        project: scenario.project,
        subject: DecisionSubject.cases.Finish.make({
          ask: AskId.make(ask),
          head: sha(ask),
        }),
      });
    };

    const parser = forPaths("packages/parser/src/iso.ts", "parse-iso");
    const format = forPaths("packages/format/src/week.ts", "format-week");

    expect(todayFor({ decisions: [parser, format] }).decisions).toStrictEqual([
      format,
    ]);

    expect(
      todayFor({ decider: dana, decisions: [parser, format] }).decisions
    ).toStrictEqual([parser]);
  });

  it("welcomes the people whose first claim was within the last 7 days", () => {
    const page = todayFor({
      decisions: [],
      firstClaims: [
        { at: at("2026-09-30T11:59:59Z"), handle: handle("bob") },
        { at: at("2026-10-01T12:00:00Z"), handle: handle("carol") },
        { at: at("2026-10-08T09:00:00Z"), handle: handle("erin") },
        { at: at("2026-08-01T09:00:00Z"), handle: handle("frank") },
      ],
    });

    expect(page.newcomers).toStrictEqual([handle("carol"), handle("erin")]);
  });

  it("samples at most 5 landings that needed nobody, newest first", () => {
    const landing = (
      seed: string,
      hoursAgo: number,
      roles: readonly CreditRole[] = []
    ): LandingView => ({
      ask: AskId.make("parse-iso"),
      assisted: [],
      author: handle("bob"),
      credits: [
        { handle: handle("bob"), role: "Signed-off-by" },
        { handle: alice, role: "Asked-by" },
        ...roles.map((role) => ({ handle: dana, role })),
      ],
      landedAt: DateTime.subtract(now, { hours: hoursAgo }),
      parent: LandedSha.make(sha(`${seed}^`)),
      project: scenario.project,
      sha: LandedSha.make(sha(seed)),
    });

    const unattended = (hoursAgo: number) =>
      landing(`unattended ${hoursAgo}`, hoursAgo);

    const { ask: _ask, ...danasOwn } = landing("dana's own", 0.1);

    const page = todayFor({
      decisions: [],
      landings: [
        unattended(4),
        landing("decided", 0.5, ["Decided-by"]),
        unattended(1),
        unattended(6),
        landing("finished", 0.25, ["Finished-by"]),
        { ...danasOwn, author: dana },
        unattended(2),
        unattended(5),
        unattended(3),
      ],
    });

    expect(page.unattended).toStrictEqual(
      [1, 2, 3, 4, 5].map((hoursAgo) => unattended(hoursAgo))
    );
  });
});
