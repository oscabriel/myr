/**
 * Admission of sealed checks, pure (W6; 615 builds it, OSR §5.5): a layer
 * push's plan (each changed area's checks green on main k times, red on a
 * known-bad tree, and a cited clause for each, Q17), and the judgement of
 * its results.
 *
 * A stub until 615: it plans no run and admits nothing, so a push that
 * waits on admission stays proposed.
 */
import type {
  LayerManifest,
  LedgerEntry,
  SealedChecks,
} from "@repo/protocol/domain/visibility";
import type { AreaName, CommitSha, LandedSha } from "@repo/protocol/ids";
import type { UnstatedRequirement } from "@repo/protocol/refusal";
import { Result } from "effect";
import type { Option } from "effect";

import type { AdmissionPlan, AdmissionReport } from "../visibility-port.ts";

/** What an admission's runs came to: the areas admitted, as ledger entries, and the areas refused, with why. */
export interface AdmissionResult {
  readonly admitted: readonly LedgerEntry[];
  readonly refused: readonly {
    readonly area: AreaName;
    readonly reason: "flaky" | "catchesNothing";
  }[];
}

/** The runs that admit a layer push's checks; `UnstatedRequirement` for a check that cites no clause. */
export const planAdmission = (input: {
  readonly head: CommitSha;
  readonly main: LandedSha;
  readonly manifest: LayerManifest;
  readonly policy: SealedChecks;
  readonly previous: Option.Option<LayerManifest>;
}): Result.Result<AdmissionPlan, UnstatedRequirement> =>
  Result.succeed({
    head: input.head,
    layer: input.manifest.layer,
    main: input.main,
    runs: [],
  });

/** An admission's results, judged. */
export const judgeAdmission = (
  _plan: AdmissionPlan,
  _results: AdmissionReport["results"]
): AdmissionResult => ({ admitted: [], refused: [] });
