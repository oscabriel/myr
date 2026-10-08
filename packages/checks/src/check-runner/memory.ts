/**
 * `CheckRunner` from a script, for tests: each `(tree or commit, lane)` gets
 * its scripted results in order, and the last one again once they run out.
 * A pair with no script is `VerifierBlocked`, as a Checker that cannot run is.
 * A count lane (`output: "stdout"`) prints what `outputs` scripts for its
 * pair, a linter's JSON as it was recorded, and nothing when none is.
 */
import type { LaneResult } from "@repo/protocol/domain/answer";
import type { LaneName } from "@repo/protocol/ids";
import { VerifierBlocked } from "@repo/protocol/refusal";
import { Array, Effect, Layer, Option, Ref } from "effect";

import { CheckRunner, shaOf } from "../check-runner.ts";
import type { CheckAt, LaneEvidence, LaneOutput } from "../check-runner.ts";

/** Where a lane's script lives in the map: `<tree or commit sha>:<lane>`. */
export const scriptKey = (at: CheckAt, lane: LaneName) =>
  `${shaOf(at)}:${lane}`;

/**
 * A scripted lane has no output to read, so a scripted failure counts as one
 * assertion failing the same way every time: two of them on main are red
 * first. Any other result that is not a pass leaves no signature.
 */
const evidenceOf = ({ lane, result }: LaneResult): LaneEvidence =>
  result === "failed"
    ? { lane, signature: `${lane}: scripted failure` }
    : { lane };

export const CheckRunnerMemory = {
  /**
   * `script` holds each pair's results; `outputs`, read when a job runs (so
   * a test may add to it later), the stdout each count lane prints, by the
   * same key.
   */
  layer: (
    script: ReadonlyMap<string, readonly LaneResult[]>,
    outputs: ReadonlyMap<string, string> = new Map()
  ): Layer.Layer<CheckRunner> =>
    Layer.effect(
      CheckRunner,
      Effect.gen(function* () {
        // How many results each key has served.
        const served = yield* Ref.make<ReadonlyMap<string, number>>(new Map());

        const next = (
          key: string,
          results: Array.NonEmptyReadonlyArray<LaneResult>
        ) =>
          Ref.modify(served, (counts) => {
            const count = counts.get(key) ?? 0;

            return [
              results[Math.min(count, results.length - 1)] ?? results[0],
              new Map(counts).set(key, count + 1),
            ] as const;
          });

        return CheckRunner.of({
          run: (job) =>
            Effect.gen(function* () {
              // Every lane has a script, or none of them advances.
              const scripted = yield* Effect.forEach(job.lanes, (lane) => {
                const key = scriptKey(job.at, lane.lane);

                return Option.match(
                  Option.filter(
                    Option.fromNullishOr(script.get(key)),
                    Array.isReadonlyArrayNonEmpty
                  ),
                  {
                    onNone: () => Effect.fail(new VerifierBlocked({})),
                    onSome: (results) => Effect.succeed({ key, lane, results }),
                  }
                );
              });

              const lanes = yield* Effect.forEach(
                scripted,
                ({ key, results }) => next(key, results)
              );

              const printed = scripted.flatMap(
                ({ key, lane }): readonly LaneOutput[] =>
                  lane.output === "stdout"
                    ? [{ lane: lane.lane, stdout: outputs.get(key) ?? "" }]
                    : []
              );

              const run = {
                durationMs: lanes.reduce(
                  (total, { durationMs }) => total + durationMs,
                  0
                ),
                evidence: lanes
                  .filter(({ result }) => result !== "passed")
                  .map(evidenceOf),
                heldBack: [],
                lanes,
              };

              return printed.length === 0 ? run : { ...run, outputs: printed };
            }),
        });
      })
    ),
};
