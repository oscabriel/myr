/**
 * `check`'s ratchets: the project's ratchets counted on this machine, on the
 * tree an answer started from and on the answer's own, by the count lanes
 * the platform's cheap stage runs (one per command, from the run block, each
 * handing back its stdout) and read by the platform's own counting code
 * (`measure` in `@repo/checks/kinds/ratchet`); then judged as the Project DO
 * judges an answer's counts, with the base's counts standing in for the
 * baselines, which no contract serves (a landing leaves each baseline at
 * what main then counts). A count over its base's is `Weakened{ratchet}`,
 * unless a reasoned escape the answer adds in that territory asks a decider
 * to raise it: then the answer will wait on that decision instead.
 *
 * A ratchet this machine cannot count (its command prints nothing the
 * counter reads, or the tree could not be checked out and set up) is named
 * with why, and left to the platform: it never fails `check`.
 */
import {
  CheckAt,
  CheckLane,
  CheckRunner,
  outputOf,
} from "@repo/checks/check-runner";
import type { CheckRun } from "@repo/checks/check-runner";
import { measure } from "@repo/checks/kinds/ratchet";
import type { RatchetCount } from "@repo/checks/kinds/ratchet";
import { escapeDecisions, territoryOf } from "@repo/gate/escapes";
import type { PushFacts } from "@repo/gate/facts";
import type { LaneOutcome } from "@repo/protocol/domain/answer";
import type { RatchetSpec } from "@repo/protocol/domain/check";
import type { Policy } from "@repo/protocol/domain/policy";
import { LaneName } from "@repo/protocol/ids";
import type {
  CommitSha,
  ProjectName,
  RatchetName,
  RepoName,
} from "@repo/protocol/ids";
import { Weakened } from "@repo/protocol/refusal";
import { Array, Effect, Option, Result, Schema } from "effect";

/** One ratchet's count in one territory, on the answer's base and on its head. */
export const RatchetMove = Schema.Struct({
  after: Schema.Int,
  before: Schema.Int,
  ratchet: Schema.String,
  territory: Schema.String,
});

export type RatchetMove = typeof RatchetMove.Type;

/** A ratchet no count was read for here, and why. */
export interface Uncounted {
  readonly ratchet: RatchetName;
  readonly why: string;
}

/** What counting on this machine gave: the counts both trees had, and what it could not count. */
export interface LocalCounts {
  readonly moves: readonly RatchetMove[];
  readonly uncounted: readonly Uncounted[];
}

/** The answer's counts judged: what refuses it, and the raises it will wait on. */
export interface LocalJudgement {
  readonly refusals: readonly Weakened[];
  readonly waiting: readonly RatchetMove[];
}

/** A ratchet in a territory: the key a baseline and a raise are kept by. */
interface Keyed {
  readonly ratchet: string;
  readonly territory: string;
}

const sameRatchet =
  (one: Keyed) =>
  (other: Keyed): boolean =>
    one.ratchet === other.ratchet && one.territory === other.territory;

/**
 * The lanes that count `ratchets`, as the platform's cheap stage makes
 * them: one per command, named for the first ratchet that runs it, each
 * handing back what it printed.
 */
const countLanes = (ratchets: readonly RatchetSpec[]): readonly CheckLane[] =>
  Array.dedupeWith(
    ratchets,
    (one, other) => one.measure.command === other.measure.command
  ).map(({ measure: { command }, name }) =>
    CheckLane.make({ command, lane: LaneName.make(name), output: "stdout" })
  );

/** How a count lane that printed no count ended, in words. */
const endings = {
  blocked: "it never ran here, or ran out of time",
  failed: "it failed",
  flaked: "it flaked",
  loadError: "it did not load",
  passed: "it passed",
} as const satisfies Record<LaneOutcome, string>;

/**
 * How a count lane that printed no count ended, when that says more: the
 * failure's signature, or else the way it ended (a command this machine
 * lacks never ran).
 */
const endedAs = (ran: CheckRun, lane: Option.Option<CheckLane>) =>
  Option.flatMap(lane, ({ lane: name }) =>
    Option.firstSomeOf([
      Array.findFirst(ran.evidence, (each) => each.lane === name).pipe(
        Option.flatMap(({ signature }) => Option.fromUndefinedOr(signature))
      ),
      Array.findFirst(ran.lanes, (each) => each.lane === name).pipe(
        Option.filter(({ result }) => result !== "passed"),
        Option.map(({ result }) => endings[result])
      ),
    ])
  );

/** One ratchet's counts per territory on one tree, or why none were read. */
interface Counted {
  readonly ratchet: RatchetName;
  readonly counts: Result.Result<readonly RatchetCount[], Uncounted>;
}

/** Each ratchet's counts from one run of its count lanes. */
const countsIn = (
  policy: Policy,
  ran: CheckRun
): Effect.Effect<readonly Counted[]> => {
  const lanes = countLanes(policy.ratchets);

  return Effect.forEach(policy.ratchets, (spec) => {
    const lane = Array.findFirst(
      lanes,
      ({ command }) => command === spec.measure.command
    );

    const printed = Option.getOrElse(
      Option.flatMap(lane, ({ lane: name }) => outputOf(ran, name)),
      () => ""
    );

    const why = `\`${spec.measure.command}\` printed no count it can read${Option.match(
      endedAs(ran, lane),
      { onNone: () => "", onSome: (text) => ` (${text})` }
    )}`;

    return measure(
      spec,
      () => Effect.succeed({ code: 0, stdout: printed }),
      policy.modules
    ).pipe(
      Effect.mapError((): Uncounted => ({ ratchet: spec.name, why })),
      Effect.result,
      Effect.map((counts): Counted => ({ counts, ratchet: spec.name }))
    );
  });
};

/**
 * The project's ratchets counted at `base` and at `head`, each tree in a
 * checkout of its own set up by the run block, as the platform counts them
 * in a Checker job of their own. A count only one tree has is not judged
 * (the platform's first landing sets that baseline).
 */
export const countRatchets = (input: {
  readonly base: CommitSha;
  readonly head: CommitSha;
  readonly policy: Policy;
  readonly project: ProjectName;
  readonly repo: RepoName;
}): Effect.Effect<LocalCounts, never, CheckRunner> =>
  Effect.gen(function* () {
    const { policy } = input;
    const runner = yield* CheckRunner;

    const countedAt = (commit: CommitSha) =>
      runner
        .run({
          at: CheckAt.cases.Commit.make({ commit }),
          lanes: countLanes(policy.ratchets),
          placeholders: [],
          project: input.project,
          proxies: [],
          repo: input.repo,
          run: policy.run,
        })
        .pipe(
          Effect.flatMap((ran) => countsIn(policy, ran)),
          Effect.catchTag("VerifierBlocked", () =>
            Effect.succeed(
              policy.ratchets.map(({ name }): Counted => ({
                counts: Result.fail({
                  ratchet: name,
                  why: `${commit.slice(0, 12)} could not be checked out and set up here`,
                }),
                ratchet: name,
              }))
            )
          )
        );

    const [before, after] = yield* Effect.all(
      [countedAt(input.base), countedAt(input.head)],
      { concurrency: "unbounded" }
    );

    const uncounted = Array.dedupeWith(
      [...before, ...after].flatMap(({ counts }) =>
        Result.isFailure(counts) ? [counts.failure] : []
      ),
      (one, other) => one.ratchet === other.ratchet
    );

    // A ratchet either tree could not count is judged by the platform alone.
    const countsOf = (all: readonly Counted[]) =>
      all.flatMap(({ counts, ratchet }) =>
        uncounted.some((each) => each.ratchet === ratchet)
          ? []
          : Result.getOrElse(counts, (): readonly RatchetCount[] => [])
      );

    const based = countsOf(before);

    const moves = countsOf(after).flatMap(
      ({ count, ratchet, territory }): readonly RatchetMove[] =>
        Option.match(
          Array.findFirst(based, sameRatchet({ ratchet, territory })),
          {
            onNone: () => [],
            onSome: (held) => [
              { after: count, before: held.count, ratchet, territory },
            ],
          }
        )
    );

    return { moves, uncounted };
  });

/**
 * The raises a push asks a decider for, as the Project DO reads them: each
 * reasoned escape it adds over its territory's escape count (a `Waiver`)
 * asks to raise every declared ratchet in that territory.
 */
export const askedRaises = (facts: PushFacts): readonly Keyed[] =>
  Option.match(facts.ask, {
    onNone: () => [],
    onSome: (ask) =>
      escapeDecisions(facts).flatMap((waiver) =>
        facts.policy.ratchets.map(({ name }) => ({
          ratchet: name,
          territory: territoryOf(facts.policy, ask, waiver.at.path),
        }))
      ),
  });

/**
 * The answer's counts judged as the platform's `judgeRatchets` judges them,
 * with each count on the base as the baseline: one over it is refused
 * `Weakened{ratchet}`, unless the answer asks to raise that ratchet in that
 * territory, when it waits on a decider instead.
 */
export const judgeMoves = (
  moves: readonly RatchetMove[],
  raises: readonly Keyed[]
): LocalJudgement => {
  const raised = moves.filter(({ after, before }) => after > before);

  const asked = (move: RatchetMove) => raises.some(sameRatchet(move));

  return {
    refusals: raised.flatMap((move) =>
      asked(move)
        ? []
        : [
            new Weakened({
              weakening: {
                after: move.after,
                before: move.before,
                ratchet: move.ratchet,
                territory: move.territory,
              },
            }),
          ]
    ),
    waiting: raised.filter(asked),
  };
};
