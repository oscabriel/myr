/**
 * The `ratchet` check kind: the lanes that count a project's ratchets, the
 * measure that reads a ratchet's declared command's output as its number
 * per territory, exactly as the project's own tool reports it, and the
 * judgement of an answer's counts against the counts it is held to. A lint
 * count splits by path, so it yields one count per territory (per-territory
 * baselines, so the children of a split land on their own); a
 * metric is one number, so it yields one. The command runs through the
 * runner it is given, never here. The platform's cheap stage and the Project
 * DO, and `<cli> check` before a push, all count and judge through here.
 */
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

/** A ratchet's number in one territory, as one run measured it. */
export interface RatchetCount {
  readonly ratchet: RatchetName;
  readonly territory: string;
  readonly count: number;
}

/**
 * The territory a ratchet counts when it names none and the project has no
 * modules, and the one a metric counts when it names none: the whole project,
 * named as a single-package repo's module is.
 */
export const WHOLE_PROJECT = ".";

/** A territory a count is split by: its name, and the globs of its paths. */
interface Counted {
  readonly name: string;
  readonly paths: readonly Glob[];
}

const ALL_PATHS: readonly Glob[] = [Glob.make("**")];

/**
 * A territory a spec names: a module by its name, or else the name read as a
 * glob, as the gate reads a ratchet's territory.
 */
const named = (
  territories: readonly Territory[],
  territory: string
): Counted => ({
  name: territory,
  paths: territories.find(({ module }) => module === territory)?.paths ?? [
    Glob.make(territory),
  ],
});

/** The territories a spec's count is split by. */
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

/**
 * Runs a ratchet's command once and reads its count per territory. A `Count`
 * reads the linter's JSON (oxlint's or ESLint's, detected; `root` makes
 * absolute paths repo-relative) for the spec's rule and yields one count per
 * territory: the one the spec names, else each module, else the whole
 * project. A `Metric` reads one integer at its path and yields one count, for
 * the territory the spec names or the whole project. The command's exit code
 * is not read (a linter with findings exits 1); output with no count in it
 * fails with `CountUnreadable`.
 */
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

/**
 * The lanes that count `ratchets`: one per command, named for the first
 * ratchet that runs it, each handing back what it printed for `measure` to
 * read (a lint's exit code says nothing of its count).
 */
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

/** A ratchet in a territory: the key a baseline, a count and a raise are kept by. */
export interface RatchetKey {
  readonly ratchet: RatchetName;
  readonly territory: string;
}

/** Whether two rows name one ratchet in one territory. */
export const sameRatchet =
  (one: RatchetKey) =>
  (other: RatchetKey): boolean =>
    one.ratchet === other.ratchet && one.territory === other.territory;

/** The decision a raise waits on. */
export type RaiseRatchet = Extract<DecisionSubject, { _tag: "RaiseRatchet" }>;

/** What judging an answer's counts gives: its refusals, and the raises it waits on. */
export interface RatchetJudgement {
  readonly refusals: readonly Weakened[];
  readonly decisions: readonly RaiseRatchet[];
}

/**
 * Judges an answer's counts against the counts it is held to (the Project
 * DO's baselines; on a person's machine, the counts on the answer's base). A
 * count at or under its baseline passes; one over it is refused with
 * `Weakened{ratchet}`, unless the answer asks to raise that ratchet in that
 * territory: then it is not refused, and waits on a `RaiseRatchet` decision
 * instead. A ratchet with no baseline yet is not judged (its first landing
 * sets it).
 */
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
