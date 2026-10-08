/**
 * `check`'s ratchets: the project's ratchets counted on this machine, on the
 * tree an answer started from and on the answer's own, by the count lanes
 * the platform's cheap stage runs (`countLanes`, from the run block, each
 * handing back its stdout) and read by the platform's own counting code
 * (`measure`); then judged by the Project DO's own `judgeRatchets` (all three
 * in `@repo/checks/kinds/ratchet`), with the base's counts standing in for
 * the baselines, which no contract serves (a landing leaves each baseline at
 * what main then counts). A count over its base's is `Weakened{ratchet}`,
 * unless a reasoned escape the answer adds in that territory asks a decider
 * to raise it (`explainedRaises` in `@repo/gate/escapes`): then the answer
 * will wait on that decision instead.
 *
 * A ratchet this machine cannot count (its command prints nothing the
 * counter reads, or the tree could not be checked out and set up) is named
 * with why, and left to the platform: it never fails `check`.
 */
import { CheckAt, CheckRunner, outputOf } from "@repo/checks/check-runner";
import type { CheckLane, CheckRun } from "@repo/checks/check-runner";
import {
  countLanes,
  judgeRatchets,
  measure,
  sameRatchet,
} from "@repo/checks/kinds/ratchet";
import type {
  RatchetCount,
  RatchetJudgement,
} from "@repo/checks/kinds/ratchet";
import { escapeDecisions, explainedRaises } from "@repo/gate/escapes";
import type { PushFacts } from "@repo/gate/facts";
import type { LaneOutcome } from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import type { Policy } from "@repo/protocol/domain/policy";
import { RatchetName } from "@repo/protocol/ids";
import type { CommitSha, ProjectName, RepoName } from "@repo/protocol/ids";
import { Array, Effect, Option, Result, Schema } from "effect";

/** One ratchet's count in one territory, on the answer's base and on its head. */
export const RatchetMove = Schema.Struct({
  after: Schema.Int,
  before: Schema.Int,
  ratchet: RatchetName,
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
 * The answer's counts judged by the Project DO's own `judgeRatchets`, with
 * each count on the base as the baseline and the raises the push's reasoned
 * escapes explain, as the Project DO reads them from the same facts: a count
 * over its base's is refused `Weakened{ratchet}`, unless the answer asks to
 * raise that ratchet in that territory, when it waits on a decider instead
 * (`decisions`).
 */
export const judgeMoves = (
  facts: PushFacts,
  ask: Ask,
  moves: readonly RatchetMove[]
): RatchetJudgement =>
  judgeRatchets({
    ask: ask.id,
    baselines: moves.map(({ before, ratchet, territory }) => ({
      count: before,
      ratchet,
      territory,
    })),
    measured: moves.map(({ after, ratchet, territory }) => ({
      count: after,
      ratchet,
      territory,
    })),
    raises: explainedRaises(facts.policy, ask, escapeDecisions(facts)),
  });
