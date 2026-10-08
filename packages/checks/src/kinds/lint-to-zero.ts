/**
 * The `lintToZero` check kind: a lint rule's count in a territory is the
 * test. It is red while the rule reports anything there and green at zero,
 * so an ask of this kind fails on main by the count itself (CAA E). The count
 * comes from `countLint`, with the rule and territory already applied.
 */
import { RatchetMeasure } from "@repo/protocol/domain/check";
import type { CheckSpec, RatchetSpec } from "@repo/protocol/domain/check";
import type { Territory } from "@repo/protocol/domain/territory";
import { RatchetName } from "@repo/protocol/ids";
import { Effect } from "effect";

import type { CountUnreadable, LintCount } from "./lint-count.ts";
import { measure } from "./ratchet.ts";

/** Red: the rule still reports something in the territory. */
export const lintToZeroRed = (count: LintCount): boolean => count.total > 0;

/** Green: the rule reports nothing in the territory. */
export const lintToZeroGreen = (count: LintCount): boolean => count.total === 0;

/** A `lintToZero` check. */
export type LintToZeroCheck = Extract<
  CheckSpec,
  { readonly _tag: "LintToZero" }
>;

/** The name a `lintToZero` check's count goes by in `measure`. */
const countName = RatchetName.make("lint-to-zero");

/**
 * What a `lintToZero` check counts in what its lint printed: the rule's
 * findings in the check's territory (a module by its name, else the name
 * read as a glob), or in `asked`, the ask's own territory, when the check
 * names none. Read by `measure`, as a ratchet's count is, so the two never
 * read a lint differently; the lint's exit code is not read.
 */
export const lintToZeroCount = (input: {
  readonly asked: Territory;
  readonly check: LintToZeroCheck;
  readonly modules: readonly Territory[];
  readonly stdout: string;
}): Effect.Effect<number, CountUnreadable> => {
  const { asked, check } = input;

  const spec: RatchetSpec = {
    measure: RatchetMeasure.cases.Count.make({
      command: check.command,
      rule: check.rule,
    }),
    name: countName,
    territory: check.territory ?? asked.module,
  };

  return Effect.map(
    measure(spec, () => Effect.succeed({ code: 0, stdout: input.stdout }), [
      asked,
      ...input.modules,
    ]),
    (counts) => counts.reduce((total, { count }) => total + count, 0)
  );
};
