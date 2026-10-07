/**
 * The `ratchet` check kind's measure: run a ratchet's declared command once
 * and read its number per territory, exactly as the project's own tool
 * reports it. A lint count splits by path, so it yields one count per
 * territory (per-territory baselines, so the children of a split land on
 * their own; FE §8.4 B3); a metric is one number, so it yields one. The
 * command runs through the runner it is given, never here.
 */
import { RatchetMeasure } from "@repo/protocol/domain/check";
import type { RatchetSpec } from "@repo/protocol/domain/check";
import { Glob } from "@repo/protocol/domain/common";
import type { Territory } from "@repo/protocol/domain/territory";
import type { RatchetName } from "@repo/protocol/ids";
import { Effect } from "effect";

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
