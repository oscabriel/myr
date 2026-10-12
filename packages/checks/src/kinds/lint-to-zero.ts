import { RatchetMeasure } from "@repo/protocol/domain/check";
import type { CheckSpec, RatchetSpec } from "@repo/protocol/domain/check";
import type { Territory } from "@repo/protocol/domain/territory";
import { RatchetName } from "@repo/protocol/ids";
import { Effect } from "effect";

import type { CountUnreadable, LintCount } from "./lint-count.ts";
import { measure } from "./ratchet.ts";

export const lintToZeroRed = (count: LintCount): boolean => count.total > 0;

export const lintToZeroGreen = (count: LintCount): boolean => count.total === 0;

export type LintToZeroCheck = Extract<
  CheckSpec,
  { readonly _tag: "LintToZero" }
>;

const countName = RatchetName.make("lint-to-zero");

// Read through `measure`, as a ratchet's count is, so the two never read a
// lint differently.
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
