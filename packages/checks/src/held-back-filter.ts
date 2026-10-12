// Only how each held-back run ended reaches here, never what it printed, so no
// name, path or output can reach a result: neither type has a field for one.
import type { HeldBackResult } from "@repo/protocol/domain/answer";
import type { AreaName, SuiteRoot } from "@repo/protocol/ids";

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

// Every declared area once, in order, even one no run counted (0 of 0).
// A run in an undeclared area counts nowhere.
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
