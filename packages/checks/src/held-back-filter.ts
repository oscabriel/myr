/**
 * What a sealed suite's run discloses: one result per
 * area, `passed` of `total` under the suite's root, and nothing else. The
 * Checker hands this module only how each held-back run ended, never what
 * it printed, so no name, path, case or line of output can reach a result:
 * neither type has a field for one.
 */
import type { HeldBackResult } from "@repo/protocol/domain/answer";
import type { AreaName, SuiteRoot } from "@repo/protocol/ids";

/** How one held-back run ended: its area, its exit code, and whether it ran out of time. */
export interface HeldBackExit {
  readonly area: AreaName;
  readonly code: number;
  readonly timedOut: boolean;
}

/**
 * A run passed only when it exited 0 within its time limit. An assertion
 * that failed, a file that would not load and a run that ran out of time
 * are each just not passed: telling them apart would disclose more than
 * one bit per check.
 */
const passed = ({ code, timedOut }: HeldBackExit) => code === 0 && !timedOut;

/**
 * The area bits of one held-back run: every declared area once, in the
 * declared order, even one no run counted (0 of 0, which the trailer shows
 * as "n/a"). A run in an area the suite does not declare counts nowhere.
 */
export const areaBits = ({
  areas,
  exits,
  suite,
}: {
  readonly exits: readonly HeldBackExit[];
  readonly areas: readonly AreaName[];
  readonly suite: SuiteRoot;
}): readonly HeldBackResult[] =>
  [...new Set(areas)].map((area) => {
    const runs = exits.filter((exit) => exit.area === area);

    return {
      area,
      passed: runs.filter(passed).length,
      suite,
      total: runs.length,
    };
  });
