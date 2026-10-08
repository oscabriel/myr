/**
 * Attempts on held-back checks (W6 612; spec D17, OSR §4.1): the ISO week
 * they are counted in, whether one more failure may still be judged, and
 * the live `ProjectVisibility` judging held-back runs over datekit's
 * sealed suite: area bits only, three failures a claim and ten a person,
 * area and week, and never a word to the answerer's record.
 */
import { describe, expect, it } from "@effect/vitest";
import type { HeldBackResult } from "@repo/protocol/domain/answer";
import { AreaName, AskId, LaneName, RequestId } from "@repo/protocol/ids";
import { AttemptsExhausted, HeldBackFailed } from "@repo/protocol/refusal";
import { at } from "@repo/testkit/clock";
import type { Files } from "@repo/testkit/git-client";
import { Array, DateTime, Effect, Option } from "effect";

import { isStep, nextSteps, runStep } from "../../src/answer-runs/steps.ts";
import { ProjectStore } from "../../src/project-store.ts";
import type { ProjectApi } from "../../src/project.ts";
import { ProjectVisibility } from "../../src/visibility-port.ts";
import type { PinnedClaim } from "../../src/visibility-port.ts";
import { attemptsLeft, isoWeek } from "../../src/visibility/claims.ts";
import { CheckScript, mergedAt, Pusher } from "../world.ts";
import {
  bob,
  countersigned,
  firstSuite,
  mainFiles,
  mainTip,
  pushLayer,
  repo,
  scenario,
  sealedByInes,
  visibilityWorld,
} from "./world.ts";

const policy = { perClaim: 3, perPersonPerAreaPerWeek: 10 };

const wednesday = at("2026-10-07T12:00:00Z");

describe("the ISO week attempts are counted in", () => {
  it("names the week by its year and number, as ISO 8601 does at the year's edges", () => {
    expect(
      [
        "2026-10-07T12:00:00Z",
        "2026-10-11T23:59:59Z",
        "2026-10-12T00:00:00Z",
        "2027-01-01T08:00:00Z",
        "2024-12-30T00:00:00Z",
        "2026-01-01T00:00:00Z",
      ].map((iso) => isoWeek(at(iso)))
    ).toStrictEqual([
      "2026-W41",
      "2026-W41",
      "2026-W42",
      "2026-W53",
      "2025-W01",
      "2026-W01",
    ]);
  });
});

describe("attempts left", () => {
  it("lets a failure be judged while both counts are under their caps", () => {
    expect(
      attemptsLeft({ claimCount: 2, now: wednesday, policy, weekCount: 9 })
    ).toStrictEqual({ ok: true, resetsAt: Option.none() });
  });

  it("stops at the claim's cap, and again at the week's, until the next ISO week", () => {
    const monday = Option.some(at("2026-10-12T00:00:00Z"));

    expect([
      attemptsLeft({ claimCount: 3, now: wednesday, policy, weekCount: 3 }),
      attemptsLeft({ claimCount: 1, now: wednesday, policy, weekCount: 10 }),
    ]).toStrictEqual([
      { ok: false, resetsAt: monday },
      { ok: false, resetsAt: monday },
    ]);
  });
});

const exportArea = AreaName.make("export");

const parserArea = AreaName.make("parser");

/** The project's rows as its store keeps them. */
const stored = ProjectStore.use((store) => store.load());

/** datekit with its suite sealed and in effect: the posture accepted, the layer pushed. */
const suiteSealed = Effect.gen(function* () {
  const { api } = yield* sealedByInes;

  yield* countersigned(api);
  yield* pushLayer(api, Option.none(), firstSuite);

  const row = Option.getOrThrow(Array.head((yield* stored).layers));

  const pinned = {
    at: Option.getOrThrow(Option.fromUndefinedOr(row.landedSha)),
    suite: Option.getOrThrow(Option.fromUndefinedOr(row.suiteRoot)),
  };

  return { api, pinned };
});

/** bob's claim on `ask`, pinned to `pinned`, as the port sees a claim. */
const claimOn = (ask: string, pinned: PinnedClaim["pinned"]): PinnedClaim => ({
  ask: AskId.make(ask),
  claimant: bob.handle,
  pinned,
});

/** The area bits of a run: `export` passed `exported` of 2, `parser` 1 of 1. */
const bits = (
  pinned: PinnedClaim["pinned"],
  exported: number
): readonly HeldBackResult[] => [
  { area: exportArea, passed: exported, suite: pinned.suite, total: 2 },
  { area: parserArea, passed: 1, suite: pinned.suite, total: 1 },
];

/**
 * One held-back run judged by the live port over the project as stored,
 * and what it counted committed, as the service commits a port's writes.
 */
const judged = (claim: PinnedClaim, results: readonly HeldBackResult[]) =>
  Effect.gen(function* () {
    const visibility = yield* ProjectVisibility;
    const now = yield* DateTime.now;

    const judgement = visibility.judgeHeldBack(
      { ...claim, now, requestId: RequestId.make(`req-${claim.ask}`), results },
      yield* stored
    );

    yield* ProjectStore.use((store) => store.commit(judgement.writes));

    return judgement;
  });

describe("a held-back run, judged by the live port", () => {
  it.effect(
    "fails an area twice, is out of attempts on the claim's third, and the person's at ten in a week",
    () =>
      Effect.gen(function* () {
        const { pinned } = yield* suiteSealed;
        const failing = bits(pinned, 1);

        const failed = new HeldBackFailed({
          area: exportArea,
          suite: pinned.suite,
        });

        const exhausted = new AttemptsExhausted({
          area: exportArea,
          resetsAt: at("2026-10-19T00:00:00Z"),
        });

        const first = yield* Effect.forEach(
          ["parse-iso", "parse-iso", "parse-iso", "parse-iso"],
          (ask) => judged(claimOn(ask, pinned), failing)
        );

        const more = yield* Effect.forEach(
          ["trim-input", "trim-input", "trim-input", "fix-a", "fix-a", "fix-a"],
          (ask) => judged(claimOn(ask, pinned), failing)
        );

        const fourth = yield* judged(claimOn("fix-b", pinned), failing);

        expect({
          first: first.map(({ refusals }) => refusals),
          fourth: fourth.refusals,
          more: more.map(({ refusals }) => refusals),
          rows: (yield* stored).attempts.map(({ ask, count, week }) => [
            ask,
            count,
            week,
          ]),
          trailers: [...first, ...more, fourth].filter(({ trailer }) =>
            Option.isSome(trailer)
          ),
          writes: Array.dedupe(
            [...first, ...more, fourth].flatMap(({ writes }) =>
              Object.keys(writes)
            )
          ),
        }).toStrictEqual({
          first: [[failed], [failed], [exhausted], [exhausted]],
          fourth: [exhausted],
          more: [
            [failed],
            [failed],
            [exhausted],
            [failed],
            [failed],
            [exhausted],
          ],
          rows: [
            ["parse-iso", 3, "2026-W42"],
            ["trim-input", 3, "2026-W42"],
            ["fix-a", 3, "2026-W42"],
            ["fix-b", 1, "2026-W42"],
          ],
          trailers: [],
          writes: ["attempts"],
        });
      }).pipe(Effect.provide(visibilityWorld()))
  );

  it.effect(
    "gives a run that passes every area the Held-back trailer, and counts nothing",
    () =>
      Effect.gen(function* () {
        const { pinned } = yield* suiteSealed;

        const passing = yield* judged(
          claimOn("parse-iso", pinned),
          bits(pinned, 2)
        );

        const parserOff = yield* judged(claimOn("parse-iso", pinned), [
          { area: exportArea, passed: 2, suite: pinned.suite, total: 2 },
          { area: parserArea, passed: 0, suite: pinned.suite, total: 0 },
        ]);

        expect({
          parserOff: parserOff.trailer,
          passing: [passing.refusals, passing.trailer, passing.writes],
          rows: (yield* stored).attempts,
        }).toStrictEqual({
          parserOff: Option.some(`export 2/2 @ ${pinned.suite}; parser n/a`),
          passing: [
            [],
            Option.some(
              `export 2/2 @ ${pinned.suite}; parser 1/1 @ ${pinned.suite}`
            ),
            {},
          ],
          rows: [],
        });
      }).pipe(Effect.provide(visibilityWorld()))
  );
});

/** bob's answer to `parse-iso`, merged onto main: its checks wait on the held-back run. */
const answered = (api: ProjectApi) =>
  Effect.gen(function* () {
    const base = yield* mainTip;
    const { claim } = yield* api.claim(bob, AskId.make("parse-iso"));

    const files: Files = [
      ...mainFiles.filter(([path]) => path !== "packages/parser/src/parse.ts"),
      ["packages/parser/src/parse.ts", "export const parse = (s) => s;\n"],
    ];

    const head = yield* Pusher.use((pusher) =>
      pusher.push(claim.fork, Option.some(base), files)
    );

    const requestId = RequestId.make("req-parse-iso");

    yield* api.submitAnswer(bob, {
      ask: AskId.make("parse-iso"),
      base,
      head,
      requestId,
    });

    const tree = yield* mergedAt({
      base,
      fork: claim.fork,
      head,
      main: base,
      repo,
    });

    yield* CheckScript.use((checker) =>
      Effect.forEach(
        ["redThenGreen", ...Object.keys(scenario.policy.run.checks)],
        (lane) => checker.script(tree, LaneName.make(lane), ["passed"]),
        { discard: true }
      )
    );

    const run = Option.getOrThrow(yield* api.answer(requestId));
    const merge = Option.getOrThrow(Array.findFirst(nextSteps(run), isStep));
    const reported = Option.getOrThrow(yield* runStep(run, merge));

    yield* api.advanceAnswer(requestId, reported.command, reported.report);

    return { claim, requestId };
  });

describe("a held-back run, through the project service", () => {
  it.effect(
    "is the pinned suite's job, and a failed area is HeldBackFailed, counted once per tree",
    () =>
      Effect.gen(function* () {
        const { api, pinned } = yield* suiteSealed;
        const { claim, requestId } = yield* answered(api);
        const job = yield* api.heldBackJob(requestId);
        const first = yield* api.recordHeldBack(requestId, bits(pinned, 1));
        const again = yield* api.recordHeldBack(requestId, bits(pinned, 1));
        const run = Option.getOrThrow(yield* api.answer(requestId));

        expect({
          again,
          first,
          job: Option.map(job, ({ at: layerAt, suite }) => [layerAt, suite]),
          rows: (yield* stored).attempts.map(({ area, ask, count }) => [
            area,
            ask,
            count,
          ]),
          sealed: run.sealed,
          suite: claim.suite,
        }).toStrictEqual({
          again: [
            new HeldBackFailed({ area: exportArea, suite: pinned.suite }),
          ],
          first: [
            new HeldBackFailed({ area: exportArea, suite: pinned.suite }),
          ],
          job: Option.some([pinned.at, pinned.suite]),
          rows: [["export", "parse-iso", 1]],
          sealed: true,
          suite: pinned.suite,
        });
      }).pipe(Effect.provide(visibilityWorld()))
  );
});
