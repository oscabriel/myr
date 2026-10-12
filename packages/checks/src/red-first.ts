// A check that fails to load fails because its subject is missing, and any
// answer that exports the subject could pass it; a check that fails two
// different ways is flaky.
import type { LaneName } from "@repo/protocol/ids";
import { NotRedFirst, WeakCheck } from "@repo/protocol/refusal";
import { Data, Option, Result } from "effect";

import type { CheckRun } from "./check-runner.ts";
import { diagnose, Diagnosis } from "./classify.ts";
import type { RunExit } from "./classify.ts";

export interface RunEvidence {
  readonly lane: LaneName;
  readonly exit: RunExit;
}

export interface RedSignature {
  readonly signature: string;
  readonly lane: LaneName;
}

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

export const redFirst = ([first, second]: readonly [
  RunEvidence,
  RunEvidence,
]): Result.Result<RedSignature, NotRedFirst | WeakCheck> =>
  first.lane === second.lane
    ? judge(first.lane, [readExit(first.exit), readExit(second.exit)])
    : Result.fail(new NotRedFirst({}));

// The platform never sees a run's output, only its evidence signature.
export const redFirstOfRuns = (
  [first, second]: readonly [CheckRun, CheckRun],
  lane: LaneName
): Result.Result<RedSignature, NotRedFirst | WeakCheck> =>
  judge(lane, [readRun(first, lane), readRun(second, lane)]);
