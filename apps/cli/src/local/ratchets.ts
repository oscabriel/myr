// The base's counts stand in for the baselines, which no contract serves.
// A ratchet this machine cannot count is left to the platform: it never fails `check`.
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

export const RatchetMove = Schema.Struct({
  after: Schema.Int,
  before: Schema.Int,
  ratchet: RatchetName,
  territory: Schema.String,
});

export type RatchetMove = typeof RatchetMove.Type;

export interface Uncounted {
  readonly ratchet: RatchetName;
  readonly why: string;
}

export interface LocalCounts {
  readonly moves: readonly RatchetMove[];
  readonly uncounted: readonly Uncounted[];
}

const endings = {
  blocked: "it never ran here, or ran out of time",
  failed: "it failed",
  flaked: "it flaked",
  loadError: "it did not load",
  passed: "it passed",
} as const satisfies Record<LaneOutcome, string>;

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

interface Counted {
  readonly ratchet: RatchetName;
  readonly counts: Result.Result<readonly RatchetCount[], Uncounted>;
}

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

/** A count only one tree has is not judged: the platform's first landing sets that baseline. */
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
