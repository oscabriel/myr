/**
 * Only a lane that passes on main and fails on the merged tree, in a file the
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

export interface LaneEvidence {
  readonly lane: LaneName;
  readonly onMain: LaneResult["result"];
  readonly onMerged: LaneResult["result"];
  readonly rerun: Option.Option<LaneResult["result"]>;
  readonly failingPaths: readonly RepoPath[];
  readonly logRef: string;
  readonly command: string;
  readonly isDoctor: boolean;
}

const isTrouble = (result: LaneResult["result"]) =>
  result === "flaked" || result === "blocked";

/**
 * A lane red on main too is `VerifierBlocked`. A checker that never started
 * on a tree whose main passes earns one fresh run (`Flake`); an identical
 * second failure means it was never a flake, so it counts as the answer's. A
 * failure only outside the diff is `StaleBase`.
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
