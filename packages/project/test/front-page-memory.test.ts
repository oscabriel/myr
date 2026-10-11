import { describe, expect, it } from "@effect/vitest";
import type { FrontPageEntry } from "@repo/protocol/domain/front-page";
import { AskId, Handle, KindName, ProjectName } from "@repo/protocol/ids";
import { Effect } from "effect";

import { FrontPage } from "../src/front-page.ts";
import { FrontPageMemory } from "../src/front-page/memory.ts";

const datekit = ProjectName.make("oscabriel/datekit");

const entry = (
  ask: string,
  kind: string,
  reserve?: "newcomers" | "people"
): FrontPageEntry => {
  const listing = {
    ask: AskId.make(ask),
    blockedBy: [],
    claimed: false,
    kind: KindName.make(kind),
    territory: "src/parse",
    want: `${ask} works`,
  };

  return {
    ask: reserve === undefined ? listing : { ...listing, reserve },
    posture: "open",
    project: datekit,
    takeable: reserve === undefined,
  };
};

const parseIso = entry("parse-iso", "fix");

const weekStart = entry("week-start", "fix", "newcomers");

const noAny = entry("no-any", "lintToZero", "people");

const credit = {
  area: "src/parse",
  count: 2,
  project: datekit,
  role: "Signed-off-by" as const,
};

const seeded = FrontPageMemory.layer({
  credits: [{ credit, handle: Handle.make("alice") }],
  entries: [parseIso, weekStart, noAny],
  projects: [{ openAsks: 3, posture: "open", project: datekit }],
});

describe("FrontPage in memory", () => {
  it.effect("lists the open asks it was seeded with, by kind or reserve", () =>
    Effect.gen(function* () {
      const front = yield* FrontPage;

      expect(yield* front.entries({})).toStrictEqual([
        parseIso,
        weekStart,
        noAny,
      ]);
      expect(
        yield* front.entries({ kind: KindName.make("lintToZero") })
      ).toStrictEqual([noAny]);
      expect(yield* front.entries({ reserved: "newcomers" })).toStrictEqual([
        weekStart,
      ]);
    }).pipe(Effect.provide(seeded))
  );

  it.effect("reads a person's credits whatever case their handle is in", () =>
    Effect.gen(function* () {
      const front = yield* FrontPage;

      expect(yield* front.credits(Handle.make("Alice"))).toStrictEqual([
        credit,
      ]);
      expect(yield* front.credits(Handle.make("bob"))).toStrictEqual([]);
      expect(yield* front.projects()).toStrictEqual([
        { openAsks: 3, posture: "open", project: datekit },
      ]);
    }).pipe(Effect.provide(seeded))
  );
});
