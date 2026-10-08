/**
 * Red first, for the right reason: an ask opens only when its check
 * fails on main twice in the same way, by an assertion. A check that fails to
 * load fails because its subject is missing, and any answer that exports the
 * subject could pass it; a check that fails two different ways is flaky.
 */
import type { LaneName } from "@repo/protocol/ids";
import { NotRedFirst, WeakCheck } from "@repo/protocol/refusal";
import { Data, Option, Result } from "effect";

import type { CheckRun } from "./check-runner.ts";
import { diagnose, Diagnosis } from "./classify.ts";
import type { RunExit } from "./classify.ts";

/** One run of an ask's check on main. */
export interface RunEvidence {
  readonly lane: LaneName;
  readonly exit: RunExit;
}

/** How the check fails on main, the same both times. */
export interface RedSignature {
  readonly signature: string;
  readonly lane: LaneName;
}

/** What one run says about the check, for comparing it with the other. */
type Reading =
  | { readonly _tag: "Red"; readonly signature: string }
  | { readonly _tag: "NoTests" }
  | { readonly _tag: "NotRed" };

const Reading = Data.taggedEnum<Reading>();

const readExit = (exit: RunExit): Reading =>
  Diagnosis.$match(diagnose(exit), {
    Blocked: () => Reading.NotRed(),
    Failed: ({ signature }) =>
      Option.match(signature, {
        onNone: () => Reading.NotRed(),
        onSome: (text) => Reading.Red({ signature: text }),
      }),
    LoadError: () => Reading.NotRed(),
    NoTests: () => Reading.NoTests(),
    Passed: () => Reading.NotRed(),
  });

const readRun = (run: CheckRun, lane: LaneName): Reading => {
  const result = run.lanes.find((each) => each.lane === lane)?.result;
  const evidence = run.evidence.find((each) => each.lane === lane);

  if (evidence?.weakness === "no assertion") {
    return Reading.NoTests();
  }

  return result === "failed" && evidence?.signature !== undefined
    ? Reading.Red({ signature: evidence.signature })
    : Reading.NotRed();
};

const judge = (
  lane: LaneName,
  [first, second]: readonly [Reading, Reading]
): Result.Result<RedSignature, NotRedFirst | WeakCheck> => {
  if (Reading.$is("NoTests")(first) || Reading.$is("NoTests")(second)) {
    return Result.fail(new WeakCheck({ weakness: "no assertion" }));
  }

  return Reading.$is("Red")(first) &&
    Reading.$is("Red")(second) &&
    first.signature === second.signature
    ? Result.succeed({ lane, signature: first.signature })
    : Result.fail(new NotRedFirst({}));
};

/**
 * Whether two runs of one check, from their exits, failed the same way by an
 * assertion. A run that found no tests is `WeakCheck{no assertion}`; a pass,
 * a load error, a time-out, a throw that is not an assertion, two different
 * failures or two different lanes are `NotRedFirst`.
 */
export const redFirst = ([first, second]: readonly [
  RunEvidence,
  RunEvidence,
]): Result.Result<RedSignature, NotRedFirst | WeakCheck> =>
  first.lane === second.lane
    ? judge(first.lane, [readExit(first.exit), readExit(second.exit)])
    : Result.fail(new NotRedFirst({}));

/**
 * `redFirst` for the platform, which sees two `CheckRun`s and never their
 * output: the lane must have failed both times with the same evidence
 * signature.
 */
export const redFirstOfRuns = (
  [first, second]: readonly [CheckRun, CheckRun],
  lane: LaneName
): Result.Result<RedSignature, NotRedFirst | WeakCheck> =>
  judge(lane, [readRun(first, lane), readRun(second, lane)]);
