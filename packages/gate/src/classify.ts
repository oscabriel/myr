/**
 * Classifying a failing lane: the gate never charges an answerer
 * for its own trouble, nor for a main that moved underneath them. Only a
 * lane that passes on main and fails on the merged tree, in a file the
 * answer changed or in none it can name, is the answer's failure.
 */
import type { LaneResult } from "@repo/protocol/domain/answer";
import type { CommitSha, LaneName, RepoPath } from "@repo/protocol/ids";
import {
  ChecksFailed,
  Flake,
  StaleBase,
  VerifierBlocked,
} from "@repo/protocol/refusal";
import { Option } from "effect";

/** What the platform saw of one lane on main, on the merged tree and on a fresh run. */
export interface LaneEvidence {
  readonly lane: LaneName;
  readonly onMain: LaneResult["result"];
  readonly onMerged: LaneResult["result"];
  /** The lane's fresh run on the same merged tree, once one has run. */
  readonly rerun: Option.Option<LaneResult["result"]>;
  /** The files the failure points at, when the lane's output names any. */
  readonly failingPaths: readonly RepoPath[];
  readonly logRef: string;
  /** The command that reproduces the lane: a refusal's `next`. */
  readonly command: string;
  /** Whether this is the run block's `doctor`, which checks the checker itself. */
  readonly isDoctor: boolean;
}

/** Whether a result is the platform's own trouble, not the code's: a flake, or a checker that never started. */
const isTrouble = (result: LaneResult["result"]) =>
  result === "flaked" || result === "blocked";

/**
 * How a lane's failure counts, or `None` when the lane passed on the merged
 * tree. A lane red on main too is `VerifierBlocked`. A checker that never
 * started on a tree whose main passes earns one fresh run (`Flake`); an
 * identical second failure means it was never a flake, so it counts as the
 * answer's. A failure only outside the diff is `StaleBase`.
 */
export const classifyFailure = (
  evidence: LaneEvidence,
  changedPaths: ReadonlySet<RepoPath>,
  merge: { readonly base: CommitSha; readonly main: CommitSha }
): Option.Option<ChecksFailed | Flake | VerifierBlocked | StaleBase> => {
  if (evidence.isDoctor && evidence.onMain !== "passed") {
    return Option.some(new VerifierBlocked({}));
  }

  if (evidence.onMerged === "passed") {
    return Option.none();
  }

  // The result that stands: the fresh run's, once there is one.
  const result = Option.getOrElse(evidence.rerun, () => evidence.onMerged);

  if (Option.isSome(evidence.rerun) && result === "passed") {
    return Option.some(new Flake({ lane: evidence.lane }));
  }

  if (evidence.onMain !== "passed") {
    return Option.some(new VerifierBlocked({}));
  }

  if (isTrouble(result) && Option.isNone(evidence.rerun)) {
    return Option.some(new Flake({ lane: evidence.lane }));
  }

  const outsideOnly =
    evidence.failingPaths.length > 0 &&
    evidence.failingPaths.every((path) => !changedPaths.has(path));

  return Option.some(
    outsideOnly
      ? new StaleBase({ base: merge.base, conflicts: [], main: merge.main })
      : new ChecksFailed({
          lane: evidence.lane,
          logRef: evidence.logRef,
          next: evidence.command,
        })
  );
};
