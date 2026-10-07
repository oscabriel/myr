import { describe, expect, it } from "@effect/vitest";
import type { RatchetCount } from "@repo/checks/kinds/ratchet";
import { Choice, DecisionSubject } from "@repo/protocol/domain/decision";
import { AskId, LandedSha, RatchetName } from "@repo/protocol/ids";
import { Weakened } from "@repo/protocol/refusal";
import { Arbitrary, Array, Effect, Option, Result, Schema } from "effect";

import { afterLanding, decideRaise, judgeRatchets } from "../src/ratchets.ts";
import type {
  RaiseRatchet,
  RaiseRequest,
  RatchetBaseline,
} from "../src/ratchets.ts";

const hex = (n: number) => n.toString(16).padStart(40, "0");

const shaAt = (step: number) => LandedSha.make(hex(0x1_00_00 + step));

const noExplicitAny = RatchetName.make("no-explicit-any");

const parser = "packages/parser";

const ask = AskId.make("parse-dates");

const baseline = (count: number, setAt = shaAt(0)): RatchetBaseline => ({
  count,
  ratchet: noExplicitAny,
  setAt,
  territory: parser,
});

const measuring = (count: number): RatchetCount => ({
  count,
  ratchet: noExplicitAny,
  territory: parser,
});

const raising: RaiseRequest = {
  ratchet: noExplicitAny,
  reason: "the parser's one cast, until the date types land",
  territory: parser,
};

const wire = (refusals: readonly Weakened[]) =>
  refusals.map((refusal) => Schema.encodeSync(Weakened)(refusal));

const raiseTo = (after: number): RaiseRatchet =>
  DecisionSubject.cases.RaiseRatchet.make({
    after,
    ask,
    before: 14,
    ratchet: noExplicitAny,
    territory: parser,
  });

describe(judgeRatchets, () => {
  it("refuses an answer that raises a ratchet with Weakened", () => {
    const { decisions, refusals } = judgeRatchets({
      ask,
      baselines: [baseline(14)],
      measured: [measuring(15)],
      raises: [],
    });

    expect(decisions).toStrictEqual([]);
    expect(wire(refusals)).toStrictEqual(
      wire([
        new Weakened({
          weakening: {
            after: 15,
            before: 14,
            ratchet: noExplicitAny,
            territory: parser,
          },
        }),
      ])
    );
  });

  it.each([14, 12, 0])("lets an answer through at %i", (count) => {
    expect(
      judgeRatchets({
        ask,
        baselines: [baseline(14)],
        measured: [measuring(count)],
        raises: [],
      })
    ).toStrictEqual({ decisions: [], refusals: [] });
  });

  it("turns an asked-for raise into one RaiseRatchet decision, not a refusal", () => {
    expect(
      judgeRatchets({
        ask,
        baselines: [baseline(14)],
        measured: [measuring(15)],
        raises: [raising],
      })
    ).toStrictEqual({ decisions: [raiseTo(15)], refusals: [] });
  });

  it("refuses a raise asked for in another territory", () => {
    const { decisions, refusals } = judgeRatchets({
      ask,
      baselines: [baseline(14)],
      measured: [measuring(15)],
      raises: [{ ...raising, territory: "packages/lexer" }],
    });

    expect(decisions).toStrictEqual([]);
    expect(refusals.map(({ weakening }) => weakening)).toStrictEqual([
      { after: 15, before: 14, ratchet: noExplicitAny, territory: parser },
    ]);
  });

  it("judges nothing a ratchet has no baseline for yet", () => {
    expect(
      judgeRatchets({
        ask,
        baselines: [],
        measured: [measuring(15)],
        raises: [],
      })
    ).toStrictEqual({ decisions: [], refusals: [] });
  });

  it("judges each territory against its own baseline", () => {
    const lexer = "packages/lexer";

    const { refusals } = judgeRatchets({
      ask,
      baselines: [baseline(14), { ...baseline(2), territory: lexer }],
      measured: [measuring(14), { ...measuring(3), territory: lexer }],
      raises: [],
    });

    expect(refusals.map(({ weakening }) => weakening)).toStrictEqual([
      { after: 3, before: 2, ratchet: noExplicitAny, territory: lexer },
    ]);
  });
});

describe(afterLanding, () => {
  it("lowers a baseline to a landing's lower count, by itself", () => {
    expect(
      afterLanding([baseline(14)], [measuring(12)], shaAt(1))
    ).toStrictEqual({
      baselines: [baseline(12, shaAt(1))],
      lowered: [
        { after: 12, before: 14, ratchet: noExplicitAny, territory: parser },
      ],
    });
  });

  it.each([14, 15])("keeps the baseline when a landing counts %i", (count) => {
    expect(
      afterLanding([baseline(14)], [measuring(count)], shaAt(1))
    ).toStrictEqual({ baselines: [baseline(14)], lowered: [] });
  });

  it("sets a ratchet with no baseline yet to the first landing's count", () => {
    expect(afterLanding([], [measuring(9)], shaAt(1))).toStrictEqual({
      baselines: [baseline(9, shaAt(1))],
      lowered: [],
    });
  });

  it("keeps the baselines a landing did not measure", () => {
    const lexer = { ...baseline(2), territory: "packages/lexer" };

    expect(
      afterLanding([baseline(14), lexer], [measuring(12)], shaAt(1))
    ).toStrictEqual({
      baselines: [baseline(12, shaAt(1)), lexer],
      lowered: [
        { after: 12, before: 14, ratchet: noExplicitAny, territory: parser },
      ],
    });
  });
});

describe(decideRaise, () => {
  it.each<Choice>(["accept", "adopt"])(
    "sets the raised baseline when a decider chooses %s",
    (choice) => {
      expect(
        decideRaise([baseline(14)], raiseTo(15), choice, shaAt(2))
      ).toStrictEqual([baseline(15, shaAt(2))]);
    }
  );

  it.each<Choice>(["decline", "revert"])(
    "leaves the baseline when a decider chooses %s",
    (choice) => {
      expect(
        decideRaise([baseline(14)], raiseTo(15), choice, shaAt(2))
      ).toStrictEqual([baseline(14)]);
    }
  );

  // Two answers asked to raise from 14; the raise to 18 was accepted first,
  // so main may already count 18. Accepting the stale raise to 15 must not
  // sink the baseline under main's count, or every later answer is refused.
  it("never lowers a baseline a later accepted raise overtook", () => {
    expect(
      decideRaise([baseline(18, shaAt(2))], raiseTo(15), "accept", shaAt(3))
    ).toStrictEqual([baseline(18, shaAt(2))]);
  });

  it("sets a baseline for a ratchet that has none yet", () => {
    expect(decideRaise([], raiseTo(15), "accept", shaAt(2))).toStrictEqual([
      baseline(15, shaAt(2)),
    ]);
  });

  it("touches no other ratchet or territory", () => {
    const lexer = { ...baseline(2), territory: "packages/lexer" };

    expect(
      decideRaise([baseline(14), lexer], raiseTo(15), "accept", shaAt(2))
    ).toStrictEqual([baseline(15, shaAt(2)), lexer]);
  });
});

// The model drives a project's ratchets through generated histories of
// landings, answers and decisions on the answers' raises, and after every
// step checks that no baseline rose but by an accepted RaiseRatchet.

const ratchets = [noExplicitAny, RatchetName.make("escapes")] as const;

const territories = [parser, "packages/lexer"] as const;

/** Every (ratchet, territory) pair the histories touch, by index. */
const keys = ratchets.flatMap((ratchet) =>
  territories.map((territory) => ({ ratchet, territory }))
);

const KeyIndex = Schema.Int.check(
  Schema.isBetween({ maximum: keys.length - 1, minimum: 0 })
);

const longest = 40;

/**
 * One move of a history: a landing or an answer measures some keys (a key
 * counted twice keeps its first count, as `measure` yields one per
 * territory); an answer may ask to raise some; a decision answers one of the
 * raises still waiting, picked by `pick`.
 */
const Move = Schema.Struct({
  choice: Choice,
  counts: Schema.Array(
    Schema.Struct({
      count: Schema.Int.check(Schema.isBetween({ maximum: 20, minimum: 0 })),
      key: KeyIndex,
    })
  ),
  kind: Schema.Literals(["Land", "Answer", "Decide"]),
  pick: Schema.Int.check(Schema.isBetween({ maximum: 9, minimum: 0 })),
  raises: Schema.Array(KeyIndex),
});

type Move = typeof Move.Type;

const histories = Arbitrary.array(Arbitrary.schema(Move), {
  maxLength: longest,
});

interface Model {
  readonly baselines: readonly RatchetBaseline[];
  /** Raises answers asked for, waiting on a decider. */
  readonly waiting: readonly RaiseRatchet[];
}

const sameKey =
  (one: { readonly ratchet: RatchetName; readonly territory: string }) =>
  (other: { readonly ratchet: RatchetName; readonly territory: string }) =>
    one.ratchet === other.ratchet && one.territory === other.territory;

const baselineOf = (
  baselines: readonly RatchetBaseline[],
  key: { readonly ratchet: RatchetName; readonly territory: string }
) => Array.findFirst(baselines, sameKey(key));

const measuredBy = (move: Move): readonly RatchetCount[] =>
  Array.dedupeWith(
    move.counts.flatMap(({ count, key }) =>
      Option.match(Array.get(keys, key), {
        onNone: () => [],
        onSome: (found) => [{ ...found, count }],
      })
    ),
    (one, other) => sameKey(one)(other)
  );

const raisesBy = (move: Move): readonly RaiseRequest[] =>
  move.raises.flatMap((key) =>
    Option.match(Array.get(keys, key), {
      onNone: () => [],
      onSome: (found) => [{ ...found, reason: "explained in the answer" }],
    })
  );

const approves = (choice: Choice) => choice === "accept" || choice === "adopt";

/** What one step did: its new model, and the subject it decided, if it decided one. */
interface Stepped {
  readonly model: Model;
  readonly decided: Option.Option<{
    readonly subject: RaiseRatchet;
    readonly choice: Choice;
  }>;
  readonly broken: Option.Option<string>;
  /** How many raises the step refused. */
  readonly refused: number;
}

const step = (model: Model, move: Move, at: number): Stepped => {
  const landed = shaAt(at);
  const measured = measuredBy(move);

  if (move.kind === "Land") {
    const after = afterLanding(model.baselines, measured, landed);

    const wrong = after.lowered.find(
      (lowered) =>
        !Option.match(baselineOf(model.baselines, lowered), {
          onNone: () => false,
          onSome: ({ count }) =>
            count === lowered.before && lowered.after < lowered.before,
        })
    );

    return {
      broken: Option.fromNullishOr(wrong).pipe(
        Option.map(() => "a landing reported a lowering it did not make")
      ),
      decided: Option.none(),
      model: { ...model, baselines: after.baselines },
      refused: 0,
    };
  }

  if (move.kind === "Answer") {
    const raises = raisesBy(move);

    const judged = judgeRatchets({
      ask,
      baselines: model.baselines,
      measured,
      raises,
    });

    const raised = measured.filter((count) =>
      Option.match(baselineOf(model.baselines, count), {
        onNone: () => false,
        onSome: (held) => count.count > held.count,
      })
    );

    const asked = raised.filter((count) => raises.some(sameKey(count)));

    return {
      broken:
        judged.refusals.length + judged.decisions.length === raised.length &&
        judged.decisions.length === asked.length
          ? Option.none()
          : Option.some(
              "an answer's raises were not each refused or put to a decider"
            ),
      decided: Option.none(),
      model: { ...model, waiting: [...model.waiting, ...judged.decisions] },
      refused: judged.refusals.length,
    };
  }

  const picked = Array.get(
    model.waiting,
    move.pick % Math.max(model.waiting.length, 1)
  );

  return Option.match(picked, {
    onNone: () => ({
      broken: Option.none(),
      decided: Option.none(),
      model,
      refused: 0,
    }),
    onSome: (subject) => {
      const baselines = decideRaise(
        model.baselines,
        subject,
        move.choice,
        landed
      );

      // An accepted raise another accepted raise overtook must not lower the
      // baseline: main may already count the higher one.
      const sank = Option.exists(baselineOf(model.baselines, subject), (held) =>
        Option.exists(
          baselineOf(baselines, subject),
          (now) => now.count < held.count
        )
      );

      return {
        broken: sank
          ? Option.some("a decision on a raise lowered a baseline")
          : Option.none(),
        decided: Option.some({ choice: move.choice, subject }),
        model: {
          baselines,
          waiting: model.waiting.filter((waiting) => waiting !== subject),
        },
        refused: 0,
      };
    },
  });
};

/** The first baseline that rose in a step, unless an accepted raise of it set it. */
const roseUnasked = (before: Model, stepped: Stepped): Option.Option<string> =>
  Array.findFirst(stepped.model.baselines, (now) =>
    Option.match(baselineOf(before.baselines, now), {
      onNone: () => false,
      onSome: (held) =>
        now.count > held.count &&
        !Option.exists(
          stepped.decided,
          ({ choice, subject }) =>
            approves(choice) &&
            sameKey(subject)(now) &&
            subject.after === now.count
        ),
    })
  ).pipe(
    Option.map(
      ({ count, ratchet, territory }) =>
        `${ratchet} in ${territory} rose to ${count} with no accepted raise`
    )
  );

/** A history's end, and what happened on the way. */
interface Run {
  readonly model: Model;
  readonly lowered: number;
  readonly accepted: number;
  readonly refused: number;
}

const begin: Model = { baselines: [], waiting: [] };

/** How many baselines moved down from one model to the next. */
const loweredBetween = (before: Model, after: Model) =>
  after.baselines.filter((now) =>
    Option.exists(
      baselineOf(before.baselines, now),
      (held) => now.count < held.count
    )
  ).length;

/** Runs a history; fails with the first broken rule and where it broke. */
const run = (moves: readonly Move[]): Result.Result<Run, string> => {
  let ran: Run = { accepted: 0, lowered: 0, model: begin, refused: 0 };

  for (const [at, move] of moves.entries()) {
    const before = ran.model;
    const stepped = step(before, move, at + 1);

    const violation = Option.orElse(stepped.broken, () =>
      roseUnasked(before, stepped)
    );

    if (Option.isSome(violation)) {
      return Result.fail(
        `step ${at}: ${violation.value}, on ${JSON.stringify(move)}`
      );
    }

    ran = {
      accepted:
        ran.accepted +
        (Option.exists(stepped.decided, ({ choice }) => approves(choice))
          ? 1
          : 0),
      lowered: ran.lowered + loweredBetween(before, stepped.model),
      model: stepped.model,
      refused: ran.refused + stepped.refused,
    };
  }

  return Result.succeed(ran);
};

const holds = (moves: readonly Move[]) =>
  Result.match(run(moves), {
    onFailure: (violation) => Effect.fail(violation),
    onSuccess: () => Effect.succeed(true),
  });

/**
 * Generated histories are CPU work alone: under a second on an idle machine,
 * several seconds while turbo runs every package's tests at once (the CLI's
 * build test compiles binaries beside them). This limit is there to catch a
 * hang, not a busy machine.
 */
const generated = { timeout: 30_000 };

describe("ratchets over generated histories", generated, () => {
  it.effect("no baseline rises but through an accepted RaiseRatchet", () =>
    Effect.gen(function* () {
      const result = yield* Arbitrary.checkEffect(histories, holds, {
        runs: 2000,
        seed: 403,
        size: longest,
      });

      expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
    })
  );

  // A model whose histories never lower, refuse or raise proves nothing.
  it.effect("lowers, refuses and accepts raises in the histories it runs", () =>
    Effect.gen(function* () {
      const sample = yield* Arbitrary.sampleEffect(histories, {
        count: 500,
        seed: 403,
        size: longest,
      });

      const runs = sample.flatMap((moves) =>
        Result.match(run(moves), {
          onFailure: () => [],
          onSuccess: (ran) => [ran],
        })
      );

      expect(runs).toHaveLength(sample.length);
      expect(runs.some(({ lowered }) => lowered > 0)).toBeTruthy();
      expect(runs.some(({ refused }) => refused > 0)).toBeTruthy();
      expect(runs.some(({ accepted }) => accepted > 0)).toBeTruthy();
    })
  );
});
