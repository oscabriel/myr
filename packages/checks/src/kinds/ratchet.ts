import { RatchetMeasure } from "@repo/protocol/domain/check";
import type { RatchetSpec } from "@repo/protocol/domain/check";
import { Glob } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Territory } from "@repo/protocol/domain/territory";
import { LaneName } from "@repo/protocol/ids";
import type { AskId, RatchetName } from "@repo/protocol/ids";
import { Weakened } from "@repo/protocol/refusal";
import { Array, Effect, Option } from "effect";

import type { CheckLane } from "../check-runner.ts";
import { countLint, countWithin } from "./lint-count.ts";
import type { CountUnreadable } from "./lint-count.ts";
import { readMetric } from "./metric.ts";

export interface RatchetCount {
  readonly ratchet: RatchetName;
  readonly territory: string;
  readonly count: number;
}

export const WHOLE_PROJECT = ".";

interface Counted {
  readonly name: string;
  readonly paths: readonly Glob[];
}

const ALL_PATHS: readonly Glob[] = [Glob.make("**")];

const named = (
  territories: readonly Territory[],
  territory: string
): Counted => ({
  name: territory,
  paths: territories.find(({ module }) => module === territory)?.paths ?? [
    Glob.make(territory),
  ],
});

const countedIn = (
  spec: RatchetSpec,
  territories: readonly Territory[]
): readonly Counted[] => {
  if (spec.territory !== undefined) {
    return [named(territories, spec.territory)];
  }

  return territories.length === 0
    ? [{ name: WHOLE_PROJECT, paths: ALL_PATHS }]
    : territories.map(({ module, paths }) => ({ name: module, paths }));
};

// The command's exit code is not read: a linter with findings exits 1.
export const measure = <E, R>(
  spec: RatchetSpec,
  run: (
    command: string
  ) => Effect.Effect<{ readonly code: number; readonly stdout: string }, E, R>,
  territories: readonly Territory[],
  options: { readonly root?: string } = {}
): Effect.Effect<readonly RatchetCount[], E | CountUnreadable, R> =>
  RatchetMeasure.match(spec.measure, {
    Count: ({ command, rule }) =>
      run(command).pipe(
        Effect.flatMap(({ stdout }) =>
          Effect.fromResult(
            countLint({ output: stdout, root: options.root, rule })
          )
        ),
        Effect.map((count) =>
          countedIn(spec, territories).map(({ name, paths }) => ({
            count: countWithin(count, paths).total,
            ratchet: spec.name,
            territory: name,
          }))
        )
      ),
    Metric: ({ command, path }) =>
      run(command).pipe(
        Effect.flatMap(({ stdout }) =>
          Effect.fromResult(readMetric(stdout, path))
        ),
        Effect.map((count) => [
          {
            count,
            ratchet: spec.name,
            territory: spec.territory ?? WHOLE_PROJECT,
          },
        ])
      ),
  });

export const countLanes = (
  ratchets: readonly RatchetSpec[]
): readonly CheckLane[] =>
  Array.dedupeWith(
    ratchets,
    (one, other) => one.measure.command === other.measure.command
  ).map(({ measure: { command }, name }) => ({
    command,
    lane: LaneName.make(name),
    output: "stdout",
  }));

export interface RatchetKey {
  readonly ratchet: RatchetName;
  readonly territory: string;
}

export const sameRatchet =
  (one: RatchetKey) =>
  (other: RatchetKey): boolean =>
    one.ratchet === other.ratchet && one.territory === other.territory;

export type RaiseRatchet = Extract<DecisionSubject, { _tag: "RaiseRatchet" }>;

export interface RatchetJudgement {
  readonly refusals: readonly Weakened[];
  readonly decisions: readonly RaiseRatchet[];
}

// A count over its baseline is refused unless the answer asks to raise that
// ratchet, which then waits on a `RaiseRatchet` decision. A ratchet with no
// baseline yet is not judged: its first landing sets it.
export const judgeRatchets = (input: {
  readonly baselines: readonly RatchetCount[];
  readonly measured: readonly RatchetCount[];
  readonly ask: AskId;
  readonly raises: readonly RatchetKey[];
}): RatchetJudgement => {
  const raised = input.measured.flatMap((measured) =>
    Option.match(Array.findFirst(input.baselines, sameRatchet(measured)), {
      onNone: () => [],
      onSome: (held) =>
        measured.count > held.count
          ? [
              {
                after: measured.count,
                asked: input.raises.some(sameRatchet(measured)),
                before: held.count,
                ratchet: measured.ratchet,
                territory: measured.territory,
              },
            ]
          : [],
    })
  );

  return {
    decisions: raised
      .filter(({ asked }) => asked)
      .map(({ after, before, ratchet, territory }) =>
        DecisionSubject.cases.RaiseRatchet.make({
          after,
          ask: input.ask,
          before,
          ratchet,
          territory,
        })
      ),
    refusals: raised
      .filter(({ asked }) => !asked)
      .map(
        ({ after, before, ratchet, territory }) =>
          new Weakened({ weakening: { after, before, ratchet, territory } })
      ),
  };
};
